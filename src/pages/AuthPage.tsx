import { useState, type FormEvent } from 'react'
import { ArrowRight, Boxes, Check, Factory, Grid3X3, LockKeyhole, Mail, UserRound } from 'lucide-react'
import { authRepository, type AuthUser } from '../repository/authRepository'

export function AuthPage({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const switchMode = (next: 'login' | 'register') => {
    setMode(next)
    setError(null)
    setPassword('')
    setConfirmPassword('')
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (mode === 'register' && password !== confirmPassword) {
      setError('两次输入的密码不一致。')
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
    <main className="entry-page auth-page">
      <section className="entry-hero" aria-label="ForgeCore 产品介绍">
        <div className="entry-brand"><span><Factory /></span><div><strong>ForgeCore</strong><small>DIGITAL FACTORY</small></div></div>
        <div className="entry-hero__copy">
          <span className="eyebrow">BUILD · CONNECT · SIMULATE</span>
          <h1>从一块空白网格，<br />搭建你的数字工厂。</h1>
          <p>自由定义物品与配方，放置机器，铺设会自动识别转弯的传送带，再用确定性仿真验证整条生产链。</p>
        </div>
        <ul className="entry-feature-list">
          <li><Grid3X3 /><span><strong>可视网格建造</strong><small>所见即所得的工厂布局</small></span><Check /></li>
          <li><Boxes /><span><strong>自定义生产流程</strong><small>物品、配方与机器由你定义</small></span><Check /></li>
          <li><Factory /><span><strong>真实模型优先</strong><small>已审计资产与清晰来源边界</small></span><Check /></li>
        </ul>
        <small className="entry-hero__foot">INITIAL RELEASE · LOCAL WORKSPACE</small>
      </section>

      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-panel__inner">
          <span className="eyebrow">WELCOME TO FORGECORE</span>
          <h2 id="auth-title">{mode === 'login' ? '登录工作区' : '创建本地账户'}</h2>
          <p>{mode === 'login' ? '继续管理属于你的工厂项目。' : '创建后将进入空白主菜单，不会注入演示存档。'}</p>

          <div className="auth-mode-switch" role="tablist" aria-label="账户操作">
            <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => switchMode('login')}>登录</button>
            <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'is-active' : ''} onClick={() => switchMode('register')}>注册</button>
          </div>

          <form className="auth-form" onSubmit={submit}>
            {mode === 'register' && <label><span>显示名称</span><div><UserRound /><input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如：林工" required minLength={2} /></div></label>}
            <label><span>邮箱</span><div><Mail /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" required /></div></label>
            <label><span>密码</span><div><LockKeyhole /><input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 个字符" required minLength={8} /></div></label>
            {mode === 'register' && <label><span>确认密码</span><div><LockKeyhole /><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入密码" required minLength={8} /></div></label>}
            {error && <p className="form-message form-message--error" role="alert">{error}</p>}
            <button className="entry-primary-action" type="submit" disabled={submitting}>{submitting ? '正在处理…' : mode === 'login' ? '登录并进入' : '注册并进入'}<ArrowRight /></button>
          </form>

          <p className="auth-local-note"><LockKeyhole />初版账户与存档只保存在当前浏览器。密码使用加盐摘要保存，不存储明文。</p>
        </div>
      </section>
    </main>
  )
}
