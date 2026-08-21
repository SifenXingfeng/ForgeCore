import { FormEvent, useState } from 'react'
import { useAuthStore } from '../store/auth'

/**
 * 舰桥认证 HUD。表单是右舷壁挂终端，中央视野完整留给 3D 双开舱门。
 * 登录成功后不直接消失，而是先收拢为通行确认，再随推镜退场。
 */
export function LoginOverlay() {
  const phase = useAuthStore((s) => s.phase)
  const busy = useAuthStore((s) => s.busy)
  const login = useAuthStore((s) => s.login)
  const register = useAuthStore((s) => s.register)

  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const entering = phase === 'entering'

  const switchMode = (next: 'login' | 'register') => {
    setMode(next)
    setError(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (username.trim().length < 2) {
      setError('驾驶员 ID 至少需要 2 个字符')
      return
    }
    if (password.length < 6) {
      setError('访问密钥至少需要 6 位')
      return
    }
    setError(null)
    try {
      if (mode === 'login') await login(username, password)
      else await register(username, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : '认证链路中断，请检查基地连接')
    }
  }

  return (
    <div className={`fm-login ${entering ? 'is-entering' : ''}`}>
      <div className="fm-login-vignette" />
      <div className="fm-login-grain" />
      <div className="fm-login-scanline" />
      <div className="fm-shaft-strip fm-shaft-strip-left" aria-hidden="true" />
      <div className="fm-shaft-strip fm-shaft-strip-right" aria-hidden="true" />

      <header className="fm-login-masthead">
        <div className="fm-login-lockup">
          <img className="fm-login-emblem" src="/brand/forgemind-emblem.png" alt="" />
          <div>
            <img className="fm-login-wordmark" src="/brand/forgemind-wordmark.png" alt="ForgeMind" />
            <p>SMART MANUFACTURING PLATFORM</p>
          </div>
        </div>
        <div className="fm-login-route" aria-label="当前航线">
          <span>ORBITAL LIFT</span>
          <i />
          <strong>A-01</strong>
          <small>工厂主甲板</small>
        </div>
      </header>

      <aside className="fm-login-telemetry" aria-label="升降舱状态">
        <div className="fm-telemetry-title"><span /> ASCENSION LINK</div>
        <div className="fm-deck-readout"><small>当前甲板</small><strong>041</strong><em>↑</em></div>
        <div className="fm-lift-meter" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) => <i key={index} />)}
        </div>
        <dl>
          <div><dt>垂直速度</dt><dd>12.8 M/S</dd></div>
          <div><dt>舱压</dt><dd>101.3 KPA</dd></div>
          <div><dt>链路</dt><dd className="is-online">已同步</dd></div>
        </dl>
      </aside>

      <div className="fm-login-door-label" aria-hidden="true">
        <span>FORGEMIND / SECURE TRANSIT</span>
        <strong>等待身份授权</strong>
        <i />
      </div>

      <form className="fm-login-console" onSubmit={submit} aria-label="ForgeMind 身份验证">
        <div className="fm-console-hardware" aria-hidden="true"><i /><i /><i /></div>
        <div className="fm-console-head">
          <div>
            <span className="fm-console-kicker">IDENTITY GATE / 7A</span>
            <h1>{mode === 'login' ? '舰桥通行认证' : '登记新驾驶员'}</h1>
          </div>
          <div className="fm-console-status"><span /> 待命</div>
        </div>

        <p className="fm-console-intro">
          {mode === 'login'
            ? '验证操作员权限，舱门将在授权后接入数字工厂主甲板。'
            : '建立本地驾驶员档案，并授予 A-01 基地访问权限。'}
        </p>

        <div className="fm-login-mode" role="tablist" aria-label="认证方式">
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => switchMode('login')}>
            <span>01</span>已有身份
          </button>
          <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'is-active' : ''} onClick={() => switchMode('register')}>
            <span>02</span>首次登记
          </button>
        </div>

        <label className="fm-login-field">
          <span><b>驾驶员 ID</b><em>OPERATOR CALLSIGN</em></span>
          <div className="fm-field-control">
            <i>⌁</i>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="输入用户名"
              autoComplete="username"
              autoFocus
              disabled={busy || entering}
            />
          </div>
        </label>

        <label className="fm-login-field">
          <span><b>访问密钥</b><em>ACCESS CREDENTIAL</em></span>
          <div className="fm-field-control">
            <i>◆</i>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 6 位"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              disabled={busy || entering}
            />
          </div>
        </label>

        <div className={`fm-login-feedback ${error ? 'has-error' : ''}`} role="status">
          <span />
          {error ?? (busy ? '正在与基地认证节点握手…' : '认证通道安全 · 凭证仅用于本地基地')}
        </div>

        <button type="submit" className="fm-login-submit" disabled={busy || entering}>
          <span>{busy ? '验证中' : mode === 'login' ? '授权并开启舱门' : '登记并进入基地'}</span>
          <b aria-hidden="true">››</b>
        </button>

        <div className="fm-console-foot">
          <span>BT-7274 LINKED</span>
          <span>ENCRYPTION / LOCAL</span>
          <span>BUILD 0.1.0</span>
        </div>
      </form>

      <div className="fm-entry-confirm" role="status" aria-live="polite">
        <span className="fm-entry-check">✓</span>
        <div><small>IDENTITY CONFIRMED</small><strong>欢迎回来，驾驶员</strong></div>
        <i />
        <em>舱门开启中</em>
      </div>

      <footer className="fm-login-footer">
        <span>FM-OS / 舰桥协议 01</span>
        <div><i /> 舱体上升中 <b>ASCENDING</b></div>
        <span>CN-SH / 31.2304° N</span>
      </footer>
    </div>
  )
}
