import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import { normalizeProfile, PRESETS } from '@core/typing/profiles'
import type { ProviderId, Settings, SettingsPatch } from '@shared/types'

/** A provider credential, encrypted with the OS keychain (DPAPI on Windows), base64. */
interface StoredSecret {
  enc: string
  /** How it was obtained: pasted by the user, or issued by signing in. */
  via: 'key' | 'sign-in'
}

interface StoredSettings extends Settings {
  secrets?: Partial<Record<ProviderId, StoredSecret>>
  /** Pre-2.0: the single Claude key. Migrated into `secrets.anthropic`. */
  apiKeyEnc?: string
}

export const DEFAULT_MODEL = 'claude-opus-5-5'

const defaults = (): StoredSettings => ({
  humanization: { ...PRESETS.veryHuman },
  // 'offline' samples exist for tests and demos; users pick a real provider.
  codegen: { provider: 'anthropic', model: DEFAULT_MODEL },
  hotkeys: { stop: 'Control+Alt+Escape', pauseResume: 'Control+Alt+P' },
  editorSafeMode: true,
  countdownSeconds: 3,
  mode: 'code'
})

/** JSON settings in the user-data folder. Secrets are encrypted and never leave the main process. */
export class SettingsStore {
  private data: StoredSettings
  private readonly file: string

  constructor(dir: string) {
    this.file = join(dir, 'settings.json')
    this.data = this.load()
  }

  private load(): StoredSettings {
    const base = defaults()
    if (!existsSync(this.file)) return base
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StoredSettings>
      const data: StoredSettings = {
        ...base,
        ...raw,
        humanization: normalizeProfile({ ...base.humanization, ...raw.humanization }),
        codegen: { ...base.codegen, ...raw.codegen },
        hotkeys: { ...base.hotkeys, ...raw.hotkeys },
        secrets: { ...raw.secrets }
      }
      if (raw.apiKeyEnc && !data.secrets!.anthropic) data.secrets!.anthropic = { enc: raw.apiKeyEnc, via: 'key' }
      delete data.apiKeyEnc
      return data
    } catch {
      return base
    }
  }

  private save(): void {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2))
  }

  get(): Settings {
    const { apiKeyEnc: _a, secrets: _s, ...rest } = this.data
    return rest
  }

  update(patch: SettingsPatch): Settings {
    this.data = {
      ...this.data,
      ...patch,
      humanization: patch.humanization ? normalizeProfile(patch.humanization) : this.data.humanization,
      codegen: { ...this.data.codegen, ...patch.codegen },
      hotkeys: { ...this.data.hotkeys, ...patch.hotkeys },
      countdownSeconds: Math.max(0, Math.min(10, Math.round(patch.countdownSeconds ?? this.data.countdownSeconds)))
    }
    this.save()
    return this.get()
  }

  /** Save (or with an empty value, remove) a provider's credential. */
  setSecret(id: ProviderId, value: string, via: StoredSecret['via'] = 'key'): void {
    const secrets = { ...this.data.secrets }
    const trimmed = value.trim()
    if (!trimmed) delete secrets[id]
    else if (safeStorage.isEncryptionAvailable()) secrets[id] = { enc: safeStorage.encryptString(trimmed).toString('base64'), via }
    else throw new Error('Secure storage is unavailable on this system. Use an environment variable for the key instead.')
    this.data.secrets = secrets
    this.save()
  }

  getSecret(id: ProviderId): { value: string; via: StoredSecret['via'] } | undefined {
    const s = this.data.secrets?.[id]
    if (!s || !safeStorage.isEncryptionAvailable()) return undefined
    try {
      return { value: safeStorage.decryptString(Buffer.from(s.enc, 'base64')), via: s.via }
    } catch {
      return undefined // encrypted for another user/machine
    }
  }
}
