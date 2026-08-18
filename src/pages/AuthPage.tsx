import { useRef, useState, type FormEvent } from 'react'
import { ArrowRight, LockKeyhole, Mail, Plus, UserRound } from 'lucide-react'
import { motion } from 'motion/react'
import { authRepository, type AuthUser } from '../repository/authRepository'

const VIDEO_URL = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260508_215831_c6a8989c-d716-4d8d-8745-e972a2eec711.mp4'
const ease = [0.16, 1, 0.3, 1] as const

function ForgeMark() {
  return (
    <svg className="landing-logo__mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="6" y="3" width="8" height="26" rx="4" transform="rotate(-35 10 16)" />
      <rect x="18" y="3" width="8" height="26" rx="4" transform="rotate(-35 22 16)" />
    </svg>
  )
}

function SystemGridMark() {
  return (
    <svg className="landing-system__grid" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="5" cy="5" r="1.5" />
      <circle cx="15" cy="5" r="1.5" />
      <circle cx="5" cy="15" r="1.5" />
      <circle cx="15" cy="15" r="1.5" />
    </svg>
  )
}

export function AuthPage({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const displayNameRef = useRef<HTMLInputElement>(null)

  const switchMode = (next: 'login' | 'register', focus = false) => {
    setMode(next)
    setError(null)
    setPassword('')
    setConfirmPassword('')
    if (focus) window.setTimeout(() => (next === 'register' ? displayNameRef.current : emailRef.current)?.focus(), 0)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (mode === 'register' && password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }
    setSubmitting(true)
    const result = mode === 'login'
      ? await authRepository.login(email, password)
      : await authRepository.register({ displayName, email, password })
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onAuthenticated(result.user)
  }

  return (
    <main className="landing-page auth-page">
      <motion.header
        className="landing-nav"
        initial={{ y: -16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease }}
      >
        <div className="landing-nav__left">
          <a className="landing-logo" href="/" aria-label="ForgeCore 首页">
            <ForgeMark />
            <span>ForgeCore</span>
          </a>
          <button className="landing-menu-button" type="button" onClick={() => switchMode('login', true)}>
            <span className="landing-menu-button__icon"><Plus size={12} strokeWidth={3} /></span>
            <span>菜单</span>
          </button>
          <div className="landing-nav-tags" aria-label="ForgeCore 能力">
            <span>智能工厂</span>
            <span>确定性仿真</span>
          </div>
        </div>
        <div className="landing-nav__right">
          <div className="landing-system-pill">
            <button className="landing-system__button" type="button" aria-label="自适应系统"><SystemGridMark /></button>
            <span>自适应系统</span>
          </div>
        </div>
      </motion.header>

      <motion.div
        className="landing-video-wrap"
        initial={{ opacity: 0, scale: 1.05 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.8, ease }}
      >
        <video className="landing-video" src={VIDEO_URL} autoPlay muted playsInline loop preload="auto" aria-hidden="true" />
      </motion.div>
      <div className="landing-video-wash" aria-hidden="true" />

      <motion.footer
        className="landing-footer"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5, duration: 1, ease }}
      >
        <div className="landing-footer__left">
          <motion.div className="landing-subtitle" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.6, duration: 0.8, ease }}>
            <span className="landing-subtitle__dot" />
            <span>数字工厂平台 2026</span>
          </motion.div>
          <motion.h1 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.8, duration: 0.8, ease }}>
            设计工厂<br />运行未来
          </motion.h1>
          <motion.div className="landing-hero-actions" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 1, duration: 0.8, ease }}>
            <button className="landing-hero-button landing-hero-button--primary" type="button" onClick={() => switchMode('login', true)}>进入工作区<ArrowRight size={15} /></button>
            <button className="landing-hero-button landing-hero-button--secondary" type="button" onClick={() => switchMode('register', true)}>创建账户<ArrowRight size={15} /></button>
          </motion.div>
        </div>

        <div className="landing-footer__right">
          <div className="landing-topic-pills" aria-label="ForgeCore 方向">
            <span>神经形态</span>
            <span>通用智能</span>
            <span>控制论</span>
          </div>
          <section className="landing-auth" aria-labelledby="auth-title">
            <div className="landing-auth__heading">
              <h2 id="auth-title">{mode === 'login' ? '登录 ForgeCore' : '创建 ForgeCore'}</h2>
              <div className="landing-auth__mode" role="tablist" aria-label="账户操作">
                <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => switchMode('login')}>登录</button>
                <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'is-active' : ''} onClick={() => switchMode('register')}>注册</button>
              </div>
            </div>
            <form className="landing-auth__form" onSubmit={submit}>
              {mode === 'register' && <label><span>显示名称</span><div><UserRound /><input ref={displayNameRef} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="你的名称" required minLength={2} /></div></label>}
              <label><span>邮箱</span><div><Mail /><input ref={emailRef} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" required /></div></label>
              <label><span>密码</span><div><LockKeyhole /><input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 个字符" required minLength={8} /></div></label>
              {mode === 'register' && <label><span>确认密码</span><div><LockKeyhole /><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入密码" required minLength={8} /></div></label>}
              {error && <p className="landing-form-error" role="alert">{error}</p>}
              <button className="landing-auth__submit" type="submit" disabled={submitting}>{submitting ? '处理中…' : mode === 'login' ? '登录并进入' : '注册并进入'}<ArrowRight size={16} /></button>
            </form>
          </section>
        </div>
      </motion.footer>
    </main>
  )
}
