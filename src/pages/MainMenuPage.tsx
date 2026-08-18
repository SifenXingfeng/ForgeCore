import { useState, type FormEvent } from 'react'
import { ArrowRight, Clock3, Factory, Grid3X3, LogOut, Plus, ShieldCheck, UserRound } from 'lucide-react'
import type { AuthUser } from '../repository/authRepository'

interface MainMenuPageProps {
  user: AuthUser
  hasSavedFactory: boolean
  onContinue: () => void
  onCreateFactory: (input: { name: string; widthM: number; lengthM: number; gridSizeM: number }) => void
  onLogout: () => void
}

export function MainMenuPage({ user, hasSavedFactory, onContinue, onCreateFactory, onLogout }: MainMenuPageProps) {
  const [showCreate, setShowCreate] = useState(!hasSavedFactory)
  const [name, setName] = useState('我的数字工厂')
  const [widthM, setWidthM] = useState(32)
  const [lengthM, setLengthM] = useState(20)
  const [gridSizeM, setGridSizeM] = useState(1)

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onCreateFactory({ name: name.trim() || '未命名数字工厂', widthM, lengthM, gridSizeM })
  }

  return (
    <main className="entry-page menu-page">
      <header className="menu-topbar">
        <div className="entry-brand"><span><Factory /></span><div><strong>ForgeCore</strong><small>DIGITAL FACTORY</small></div></div>
        <div className="menu-user"><span><UserRound /></span><div><strong>{user.displayName}</strong><small>{user.email}</small></div><button onClick={onLogout} title="退出登录"><LogOut /><span>退出</span></button></div>
      </header>

      <section className="menu-content">
        <div className="menu-heading"><span className="eyebrow">FACTORY WORKSPACE</span><h1>从哪里开始？</h1><p>继续你主动保存的项目，或创建一个完全空白的新工厂。</p></div>

        <div className="menu-action-grid">
          <article className={`menu-action-card ${hasSavedFactory ? 'is-featured' : 'is-disabled'}`}>
            <span className="menu-action-card__icon"><Clock3 /></span>
            <div><span className="eyebrow">CONTINUE</span><h2>继续已有工厂</h2><p>{hasSavedFactory ? '恢复当前账户最近一次主动保存的布局、配方与仿真状态。' : '当前账户还没有已保存的工厂。'}</p></div>
            <button className="entry-primary-action" disabled={!hasSavedFactory} onClick={onContinue}>继续工作<ArrowRight /></button>
          </article>

          <article className="menu-action-card">
            <span className="menu-action-card__icon"><Plus /></span>
            <div><span className="eyebrow">NEW FACTORY</span><h2>新建空白工厂</h2><p>只创建网格地块，不预置机器、传送带、物品、配方或库存。</p></div>
            <button className="entry-secondary-action" onClick={() => setShowCreate((open) => !open)}>{showCreate ? '收起设置' : '配置新工厂'}<ArrowRight /></button>
          </article>
        </div>

        {showCreate && <form className="factory-create-panel" onSubmit={create}>
          <header><div><span className="eyebrow">EMPTY PROJECT SETUP</span><h2>空白地块设置</h2></div><span className="clean-start-badge"><ShieldCheck />零预设内容</span></header>
          <div className="factory-create-fields">
            <label><span>工厂名称</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
            <label><span>宽度（米）</span><input type="number" min={12} max={80} value={widthM} onChange={(event) => setWidthM(Number(event.target.value))} required /></label>
            <label><span>长度（米）</span><input type="number" min={12} max={80} value={lengthM} onChange={(event) => setLengthM(Number(event.target.value))} required /></label>
            <label><span>网格尺寸</span><select value={gridSizeM} onChange={(event) => setGridSizeM(Number(event.target.value))}><option value={0.5}>0.5 m</option><option value={1}>1 m</option><option value={2}>2 m</option></select></label>
          </div>
          <div className="factory-create-summary"><Grid3X3 /><span><strong>{widthM} × {lengthM} m</strong><small>{Math.round(widthM / gridSizeM) * Math.round(lengthM / gridSizeM)} 个网格单元 · 无初始设施</small></span></div>
          <button className="entry-primary-action" type="submit">创建并进入编辑器<ArrowRight /></button>
        </form>}
      </section>
    </main>
  )
}
