// AutoCoder Windows automation helper.
// Compiled at runtime by Windows PowerShell (Add-Type), so it must stay C# 5 compatible:
// no string interpolation, no expression-bodied members, no out-var declarations.
//
// Protocol (stdin/stdout, one line per message, tab separated, ASCII only):
//   request : <id>\t<command>\t<arg1>\t<arg2>...
//   response: <id>\t<STATUS>\t<base64 utf-8 payload>
// STATUS is OK, ERR, FOCUS_LOST (target is not the foreground window),
// GONE (target window closed / handle reused), MODIFIERS (user is holding Ctrl/Alt/Shift/Win)
// or USER_INPUT (the user pressed a key or clicked since typing started or resumed).
// FOCUS_LOST/MODIFIERS/USER_INPUT payloads start with the index of the first op that was not executed.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class AcHelper
{
    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public InputUnion U; }

    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder name, ref uint size);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
    [DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr h, uint access, out IntPtr token);
    [DllImport("advapi32.dll")] static extern bool GetTokenInformation(IntPtr token, int cls, out int info, int len, out int retLen);

    delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    struct MSLLHOOKSTRUCT { public int x; public int y; public uint mouseData; public uint flags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }

    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr hMod, uint threadId);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);

    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_EXTENDEDKEY = 0x1;
    const uint KEYEVENTF_KEYUP = 0x2;
    const uint KEYEVENTF_UNICODE = 0x4;
    const int GWL_EXSTYLE = -20;
    const int WS_EX_TOOLWINDOW = 0x80;
    const uint GW_OWNER = 4;
    const int DWMWA_CLOAKED = 14;
    // Tags our injected input so it is distinguishable from the user's.
    static readonly IntPtr MAGIC = new IntPtr(0x41430DE);

    static int ownPid;

    // ------------------------------------------------------------ user input watch
    // A low-level keyboard/mouse hook notices the user pressing a key or clicking while we
    // type. Our own input is tagged with MAGIC, so only real (or other tools') input counts.
    // Modifier keys are left to the MODIFIERS check, which waits instead of pausing.
    static volatile bool userInput;
    static volatile string userInputWhat = "";
    static HookProc keyHook, mouseHook; // kept alive for the lifetime of the hooks

    static void WatchUserInput()
    {
        keyHook = delegate (int code, IntPtr wParam, IntPtr lParam)
        {
            if (code >= 0)
            {
                int msg = wParam.ToInt32();
                if (msg == 0x100 || msg == 0x104) // WM_KEYDOWN, WM_SYSKEYDOWN
                {
                    KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                    bool modifier = (k.vkCode >= 0x10 && k.vkCode <= 0x12) || (k.vkCode >= 0xA0 && k.vkCode <= 0xA5) || k.vkCode == 0x5B || k.vkCode == 0x5C;
                    if (k.dwExtraInfo != MAGIC && !modifier) { userInputWhat = "key 0x" + k.vkCode.ToString("X2") + ((k.flags & 0x10) != 0 ? " injected" : ""); userInput = true; }
                }
            }
            return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
        };
        mouseHook = delegate (int code, IntPtr wParam, IntPtr lParam)
        {
            if (code >= 0)
            {
                int msg = wParam.ToInt32();
                if (msg == 0x201 || msg == 0x204 || msg == 0x207 || msg == 0x20B) // L/R/M/X button down
                {
                    MSLLHOOKSTRUCT m = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
                    if (m.dwExtraInfo != MAGIC) { userInputWhat = "click" + ((m.flags & 0x1) != 0 ? " injected" : ""); userInput = true; }
                }
            }
            return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
        };
        Thread t = new Thread(delegate ()
        {
            IntPtr mod = GetModuleHandle(null);
            SetWindowsHookEx(13 /* WH_KEYBOARD_LL */, keyHook, mod, 0);
            SetWindowsHookEx(14 /* WH_MOUSE_LL */, mouseHook, mod, 0);
            MSG m;
            while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { }
        });
        t.IsBackground = true;
        t.Start();
    }
    static Dictionary<uint, string> procNames = new Dictionary<uint, string>();

    public static void Run(int selfPid)
    {
        ownPid = selfPid;
        WatchUserInput();
        string line;
        while ((line = Console.In.ReadLine()) != null)
        {
            if (line.Length == 0) continue;
            string[] p = line.Split('\t');
            string id = p[0];
            string status = "OK";
            string payload = "";
            try
            {
                string[] result = Handle(p);
                status = result[0];
                payload = result[1];
            }
            catch (Exception e)
            {
                status = "ERR";
                payload = e.Message;
            }
            Console.Out.WriteLine(id + "\t" + status + "\t" + Convert.ToBase64String(Encoding.UTF8.GetBytes(payload)));
            Console.Out.Flush();
        }
    }

    static string[] Ok(string s) { return new string[] { "OK", s }; }
    static string[] Status(string s, string detail) { return new string[] { s, detail }; }

    static string[] Handle(string[] p)
    {
        string cmd = p.Length > 1 ? p[1] : "";
        switch (cmd)
        {
            case "ping": return Ok("pong");
            case "list": return Ok(ListWindows());
            case "fg": return Ok(Describe(GetForegroundWindow()));
            case "self": return Ok(IsElevated((uint)Process.GetCurrentProcess().Id) ? "elevated" : "normal");
            case "focus":
            {
                IntPtr h = ParseHandle(p[2]);
                if (!IsWindow(h)) return Status("GONE", "window closed");
                bool focused = Focus(h);
                userInput = false; // starting or resuming: only input from now on counts
                return Ok(focused ? "1" : "0");
            }
            case "run":
            {
                IntPtr h = ParseHandle(p[2]);
                uint expectedPid = uint.Parse(p[3]);
                string[] ops = p.Length > 4 && p[4].Length > 0 ? p[4].Split(' ') : new string[0];
                return RunOps(h, expectedPid, ops);
            }
            default: throw new Exception("unknown command: " + cmd);
        }
    }

    static IntPtr ParseHandle(string s) { return new IntPtr(long.Parse(s)); }

    // ------------------------------------------------------------------ windows

    static string ListWindows()
    {
        StringBuilder json = new StringBuilder("[");
        bool first = true;
        EnumWindows(delegate (IntPtr h, IntPtr l)
        {
            if (!IsCandidate(h)) return true;
            if (!first) json.Append(',');
            json.Append(Describe(h));
            first = false;
            return true;
        }, IntPtr.Zero);
        json.Append(']');
        return json.ToString();
    }

    static bool IsCandidate(IntPtr h)
    {
        if (!IsWindowVisible(h)) return false;
        if (GetWindowTextLength(h) == 0) return false;
        if (GetWindow(h, GW_OWNER) != IntPtr.Zero) return false;
        if ((GetWindowLong(h, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return false;
        int cloaked;
        if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return false;
        uint pid;
        GetWindowThreadProcessId(h, out pid);
        if (pid == (uint)ownPid) return false;
        string cls = ClassOf(h);
        if (cls == "Progman" || cls == "Shell_TrayWnd" || cls == "WorkerW") return false;
        return true;
    }

    static string ClassOf(IntPtr h)
    {
        StringBuilder sb = new StringBuilder(256);
        GetClassName(h, sb, sb.Capacity);
        return sb.ToString();
    }

    static string TitleOf(IntPtr h)
    {
        int n = GetWindowTextLength(h);
        StringBuilder sb = new StringBuilder(n + 1);
        GetWindowText(h, sb, sb.Capacity);
        return sb.ToString();
    }

    static string Describe(IntPtr h)
    {
        if (h == IntPtr.Zero) return "null";
        uint pid;
        GetWindowThreadProcessId(h, out pid);
        string exe = ExePath(pid);
        return "{\"id\":\"" + h.ToInt64() + "\",\"pid\":" + pid +
               ",\"title\":" + Json(TitleOf(h)) +
               ",\"className\":" + Json(ClassOf(h)) +
               ",\"processName\":" + Json(ProcName(pid)) +
               ",\"exePath\":" + Json(exe) +
               ",\"elevated\":" + (IsElevated(pid) ? "true" : "false") + "}";
    }

    // Windows blocks input from a normal process into an elevated (administrator) one (UIPI).
    // If the token can't be read at all, assume elevated: the same restriction usually applies.
    static bool IsElevated(uint pid)
    {
        IntPtr hp = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
        if (hp == IntPtr.Zero) return true;
        try
        {
            IntPtr token;
            if (!OpenProcessToken(hp, 0x0008 /* TOKEN_QUERY */, out token)) return true;
            try
            {
                int elevated;
                int len;
                return GetTokenInformation(token, 20 /* TokenElevation */, out elevated, 4, out len) && elevated != 0;
            }
            finally { CloseHandle(token); }
        }
        finally { CloseHandle(hp); }
    }

    static string ProcName(uint pid)
    {
        string name;
        if (procNames.TryGetValue(pid, out name)) return name;
        try { name = Process.GetProcessById((int)pid).ProcessName; } catch { name = ""; }
        procNames[pid] = name;
        return name;
    }

    static string ExePath(uint pid)
    {
        IntPtr hp = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
        if (hp == IntPtr.Zero) return "";
        try
        {
            StringBuilder sb = new StringBuilder(1024);
            uint size = (uint)sb.Capacity;
            return QueryFullProcessImageName(hp, 0, sb, ref size) ? sb.ToString() : "";
        }
        finally { CloseHandle(hp); }
    }

    static string Json(string s)
    {
        StringBuilder sb = new StringBuilder("\"");
        foreach (char c in s)
        {
            if (c == '"') sb.Append("\\\"");
            else if (c == '\\') sb.Append("\\\\");
            else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
            else sb.Append(c);
        }
        return sb.Append('"').ToString();
    }

    static bool Focus(IntPtr h)
    {
        if (IsIconic(h)) ShowWindow(h, 9 /* SW_RESTORE */);
        if (GetForegroundWindow() == h) return true;
        uint fgPid;
        uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out fgPid);
        uint self = GetCurrentThreadId();
        // Windows only lets the process that received the last input change the
        // foreground window. A synthetic Alt tap satisfies that rule.
        keybd_event(0x12, 0, 0, (UIntPtr)(ulong)MAGIC.ToInt64());
        keybd_event(0x12, 0, KEYEVENTF_KEYUP, (UIntPtr)(ulong)MAGIC.ToInt64());
        bool attached = fgThread != 0 && fgThread != self && AttachThreadInput(self, fgThread, true);
        SetForegroundWindow(h);
        BringWindowToTop(h);
        if (attached) AttachThreadInput(self, fgThread, false);
        for (int i = 0; i < 20 && GetForegroundWindow() != h; i++) Thread.Sleep(15);
        return GetForegroundWindow() == h;
    }

    // ------------------------------------------------------------------- typing

    static bool ModifiersHeld()
    {
        int[] keys = { 0x10, 0x11, 0x12, 0x5B, 0x5C }; // Shift, Ctrl, Alt, LWin, RWin
        foreach (int k in keys) if ((GetAsyncKeyState(k) & 0x8000) != 0) return true;
        return false;
    }

    static string[] RunOps(IntPtr h, uint expectedPid, string[] ops)
    {
        if (!IsWindow(h)) return Status("GONE", "window closed");
        uint pid;
        GetWindowThreadProcessId(h, out pid);
        if (pid != expectedPid) return Status("GONE", "window handle now belongs to another process");
        if (GetForegroundWindow() != h) return Status("FOCUS_LOST", "0\n" + Describe(GetForegroundWindow()));
        if (ModifiersHeld()) return Status("MODIFIERS", "0");
        if (userInput) return Status("USER_INPUT", "0\n" + userInputWhat);

        for (int i = 0; i < ops.Length; i++)
        {
            string op = ops[i];
            // Re-check before every op so a focus change can never redirect keystrokes.
            // The payload carries the index of the first op NOT executed, so callers can resume exactly.
            if (GetForegroundWindow() != h) return Status("FOCUS_LOST", i + "\n" + Describe(GetForegroundWindow()));
            if (userInput) return Status("USER_INPUT", i + "\n" + userInputWhat);
            if (op.Length == 0) continue;
            char kind = op[0];
            string arg = op.Substring(1);
            if (kind == 'T') SendText(Encoding.UTF8.GetString(Convert.FromBase64String(arg)));
            else if (kind == 'K') SendChord(arg);
            else throw new Exception("bad op: " + op);
        }
        return Ok("");
    }

    static KEYBDINPUT Key(ushort vk, ushort scan, uint flags)
    {
        KEYBDINPUT k = new KEYBDINPUT();
        k.wVk = vk; k.wScan = scan; k.dwFlags = flags; k.dwExtraInfo = MAGIC;
        return k;
    }

    static INPUT Wrap(KEYBDINPUT k)
    {
        INPUT i = new INPUT();
        i.type = INPUT_KEYBOARD;
        i.U.ki = k;
        return i;
    }

    static void Send(List<INPUT> inputs)
    {
        if (inputs.Count == 0) return;
        INPUT[] arr = inputs.ToArray();
        uint sent = SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
        if (sent != arr.Length) throw new Exception("SendInput blocked (" + Marshal.GetLastWin32Error() + ")");
    }

    static void SendText(string text)
    {
        List<INPUT> inputs = new List<INPUT>();
        foreach (char c in text)
        {
            if (c == '\r' || c == '\n') continue; // newlines are always explicit Enter keys
            inputs.Add(Wrap(Key(0, c, KEYEVENTF_UNICODE)));
            inputs.Add(Wrap(Key(0, c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)));
        }
        Send(inputs);
    }

    static void SendChord(string spec)
    {
        string[] parts = spec.ToLowerInvariant().Split('+');
        List<ushort> mods = new List<ushort>();
        ushort vk = 0;
        bool extended = false;
        foreach (string part in parts)
        {
            switch (part)
            {
                case "shift": mods.Add(0x10); break;
                case "ctrl": mods.Add(0x11); break;
                case "alt": mods.Add(0x12); break;
                case "enter": vk = 0x0D; break;
                case "backspace": vk = 0x08; break;
                case "tab": vk = 0x09; break;
                case "esc": vk = 0x1B; break;
                case "delete": vk = 0x2E; extended = true; break;
                case "home": vk = 0x24; extended = true; break;
                case "end": vk = 0x23; extended = true; break;
                case "left": vk = 0x25; extended = true; break;
                case "right": vk = 0x27; extended = true; break;
                case "up": vk = 0x26; extended = true; break;
                case "down": vk = 0x28; extended = true; break;
                default:
                    if (part.Length == 1 && char.IsLetterOrDigit(part[0])) vk = (ushort)char.ToUpperInvariant(part[0]);
                    else throw new Exception("unknown key: " + part);
                    break;
            }
        }
        List<INPUT> inputs = new List<INPUT>();
        uint ext = extended ? KEYEVENTF_EXTENDEDKEY : 0;
        foreach (ushort m in mods) inputs.Add(Wrap(Key(m, 0, 0)));
        inputs.Add(Wrap(Key(vk, 0, ext)));
        inputs.Add(Wrap(Key(vk, 0, ext | KEYEVENTF_KEYUP)));
        for (int i = mods.Count - 1; i >= 0; i--) inputs.Add(Wrap(Key(mods[i], 0, KEYEVENTF_KEYUP)));
        Send(inputs);
    }
}
