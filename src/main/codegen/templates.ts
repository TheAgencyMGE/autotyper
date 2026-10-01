/**
 * Built-in templates for the offline provider, so AutoCoder is fully usable
 * (and demoable) without an API key. Each template is matched by keywords.
 */
export interface Template {
  id: string
  keywords: string[]
  code: string
}

const reactLanding = `import { useState } from 'react'

const plans = [
  { name: 'Starter', price: 0, features: ['1 project', 'Community support', 'Basic analytics'] },
  { name: 'Pro', price: 19, features: ['Unlimited projects', 'Priority support', 'Advanced analytics'], featured: true },
  { name: 'Team', price: 49, features: ['Everything in Pro', 'SSO & roles', 'Audit logs'] }
]

const styles = \`
  :root { --bg: #07080d; --panel: #10131c; --text: #e7e9f0; --muted: #8a90a2; --accent: #7c5cff; }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--bg); color: var(--text); font-family: Inter, system-ui, sans-serif; }
  .bg { position: fixed; inset: 0; z-index: -1; overflow: hidden; }
  .blob { position: absolute; width: 480px; height: 480px; border-radius: 50%; filter: blur(90px); opacity: 0.35; }
  .blob.a { background: #7c5cff; top: -120px; left: -80px; animation: drift 18s ease-in-out infinite; }
  .blob.b { background: #00d4ff; bottom: -160px; right: -60px; animation: drift 22s ease-in-out infinite reverse; }
  @keyframes drift { 50% { transform: translate(120px, 80px) scale(1.15); } }
  nav { display: flex; justify-content: space-between; align-items: center; padding: 20px 48px; }
  nav a { color: var(--muted); text-decoration: none; margin-left: 28px; }
  nav a:hover { color: var(--text); }
  .logo { font-weight: 800; letter-spacing: -0.02em; }
  .hero { text-align: center; padding: 120px 24px 80px; }
  .hero h1 { font-size: clamp(40px, 6vw, 72px); letter-spacing: -0.03em; line-height: 1.05; }
  .hero p { color: var(--muted); font-size: 20px; max-width: 560px; margin: 24px auto 36px; }
  .btn { background: var(--accent); color: white; border: 0; padding: 14px 28px; border-radius: 12px; font-size: 16px; cursor: pointer; }
  .pricing { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 24px; max-width: 980px; margin: 0 auto 120px; padding: 0 24px; }
  .card { background: var(--panel); border: 1px solid #1d2230; border-radius: 18px; padding: 32px; }
  .card.featured { border-color: var(--accent); box-shadow: 0 0 40px rgba(124, 92, 255, 0.25); }
  .price { font-size: 44px; font-weight: 800; margin: 12px 0 20px; }
  .card li { list-style: none; color: var(--muted); padding: 6px 0; }
\`

function Navbar() {
  return (
    <nav>
      <span className="logo">Nebula</span>
      <div>
        <a href="#features">Features</a>
        <a href="#pricing">Pricing</a>
        <a href="#contact">Contact</a>
      </div>
    </nav>
  )
}

function PricingCard({ plan, yearly }) {
  const price = yearly ? Math.round(plan.price * 10) : plan.price
  return (
    <div className={plan.featured ? 'card featured' : 'card'}>
      <h3>{plan.name}</h3>
      <div className="price">
        \${price}
        <small>{yearly ? '/yr' : '/mo'}</small>
      </div>
      <ul>
        {plan.features.map((feature) => (
          <li key={feature}>✓ {feature}</li>
        ))}
      </ul>
    </div>
  )
}

export default function LandingPage() {
  const [yearly, setYearly] = useState(false)

  return (
    <>
      <style>{styles}</style>
      <div className="bg">
        <div className="blob a" />
        <div className="blob b" />
      </div>
      <Navbar />
      <header className="hero">
        <h1>Ship faster with a calmer workflow</h1>
        <p>Nebula brings your builds, previews and deploys into one quiet, focused place.</p>
        <button className="btn" onClick={() => setYearly(!yearly)}>
          Show {yearly ? 'monthly' : 'yearly'} pricing
        </button>
      </header>
      <section id="pricing" className="pricing">
        {plans.map((plan) => (
          <PricingCard key={plan.name} plan={plan} yearly={yearly} />
        ))}
      </section>
    </>
  )
}
`

const expressApi = `import express from 'express'

const app = express()
app.use(express.json())

// In-memory store; swap for a database in production.
const todos = new Map()
let nextId = 1

app.get('/api/todos', (req, res) => {
  res.json([...todos.values()])
})

app.post('/api/todos', (req, res) => {
  const { title } = req.body ?? {}
  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' })
  }
  const todo = { id: nextId++, title: title.trim(), done: false }
  todos.set(todo.id, todo)
  res.status(201).json(todo)
})

app.patch('/api/todos/:id', (req, res) => {
  const todo = todos.get(Number(req.params.id))
  if (!todo) return res.status(404).json({ error: 'not found' })
  Object.assign(todo, { done: Boolean(req.body.done) })
  res.json(todo)
})

app.delete('/api/todos/:id', (req, res) => {
  const deleted = todos.delete(Number(req.params.id))
  res.status(deleted ? 204 : 404).end()
})

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(\`API listening on http://localhost:\${port}\`)
})
`

const pythonCli = `"""Word frequency counter for text files."""
import argparse
import re
from collections import Counter
from pathlib import Path


def count_words(text: str, min_length: int = 3) -> Counter:
    """Count words in text, ignoring case and short words."""
    words = re.findall(r"[a-zA-Z']+", text.lower())
    return Counter(word for word in words if len(word) >= min_length)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path, help="text file to analyse")
    parser.add_argument("-n", "--top", type=int, default=10, help="how many words to show")
    args = parser.parse_args()

    counts = count_words(args.file.read_text(encoding="utf-8"))
    width = max((len(word) for word, _ in counts.most_common(args.top)), default=0)
    for word, count in counts.most_common(args.top):
        print(f"{word:<{width}}  {count}")


if __name__ == "__main__":
    main()
`

const htmlPage = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Portfolio</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #0d1117; color: #e6edf3; }
      header { padding: 96px 24px; text-align: center; }
      h1 { font-size: 56px; margin: 0 0 12px; }
      .projects { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; padding: 24px; }
      .project { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 24px; }
      a { color: #58a6ff; }
    </style>
  </head>
  <body>
    <header>
      <h1>Hi, I build things for the web.</h1>
      <p>Front-end engineer focused on fast, accessible interfaces.</p>
    </header>
    <main class="projects">
      <article class="project">
        <h2>Weather Now</h2>
        <p>A tiny forecast app with offline support.</p>
        <a href="#">View project</a>
      </article>
      <article class="project">
        <h2>Markdown Notes</h2>
        <p>Keyboard-first notes that sync across devices.</p>
        <a href="#">View project</a>
      </article>
    </main>
  </body>
</html>
`

const reactTodo = `import { useState } from 'react'

export default function TodoList() {
  const [todos, setTodos] = useState([])
  const [draft, setDraft] = useState('')

  function addTodo(event) {
    event.preventDefault()
    const title = draft.trim()
    if (!title) return
    setTodos([...todos, { id: Date.now(), title, done: false }])
    setDraft('')
  }

  function toggle(id) {
    setTodos(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)))
  }

  const remaining = todos.filter((t) => !t.done).length

  return (
    <div className="todo">
      <form onSubmit={addTodo}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What needs doing?" />
        <button type="submit">Add</button>
      </form>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id} onClick={() => toggle(todo.id)} className={todo.done ? 'done' : ''}>
            {todo.title}
          </li>
        ))}
      </ul>
      <p>{remaining} item(s) left</p>
    </div>
  )
}
`

const jsUtility = `/**
 * Debounce a function: it runs only after \`wait\` ms have passed without another call.
 */
export function debounce(fn, wait = 250) {
  let timer = null
  return function debounced(...args) {
    clearTimeout(timer)
    timer = setTimeout(() => fn.apply(this, args), wait)
  }
}

/**
 * Retry an async operation with exponential backoff.
 */
export async function retry(operation, { attempts = 3, baseDelay = 200 } = {}) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      const delay = baseDelay * 2 ** attempt
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastError
}
`

export const TEMPLATES: Template[] = [
  { id: 'react-landing', keywords: ['landing', 'hero', 'pricing', 'navbar', 'marketing', 'homepage'], code: reactLanding },
  { id: 'express-api', keywords: ['express', 'api', 'server', 'rest', 'endpoint', 'backend', 'node'], code: expressApi },
  { id: 'python-cli', keywords: ['python', 'script', 'cli', 'argparse', 'count', 'word'], code: pythonCli },
  { id: 'html-page', keywords: ['html', 'portfolio', 'static', 'website', 'page'], code: htmlPage },
  { id: 'react-todo', keywords: ['todo', 'list', 'task', 'checklist', 'component', 'react'], code: reactTodo },
  { id: 'js-utility', keywords: ['debounce', 'retry', 'utility', 'helper', 'function', 'util'], code: jsUtility }
]

export function pickTemplate(prompt: string): Template {
  const text = prompt.toLowerCase()
  let best = TEMPLATES[TEMPLATES.length - 1]
  let bestScore = 0
  for (const t of TEMPLATES) {
    const score = t.keywords.reduce((s, k) => s + (text.includes(k) ? 1 : 0), 0)
    if (score > bestScore) {
      best = t
      bestScore = score
    }
  }
  return best
}

/** Prose sample for AutoWriter's offline mode (tests and demos). */
export const TEXT_SAMPLE = `The Quiet Value of Small Teams

Small teams often move faster than large ones. They need fewer meetings, and every person can see how their work affects the whole. When a problem appears, the people who notice it are usually the ones who can fix it.

But small teams also have limits. A group of four cannot maintain a dozen products, and it is easy to lose sight of the bigger picture. The main risk is that important work falls between the cracks.

So what should a growing company do? Keep teams small, give them clear ownership, and make it simple for them to ask each other for help. That is harder than it sounds, but it is worth the effort.`
