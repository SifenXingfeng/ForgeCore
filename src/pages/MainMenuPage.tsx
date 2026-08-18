import { useState, type FormEvent } from 'react'
import { ArrowRight, Clock3, Grid3X3, LogOut, Plus, UserRound } from 'lucide-react'
import { motion } from 'motion/react'
import type { AuthUser } from '../repository/authRepository'

const VIDEO_URL = '/media/1.mp4'
const ease = [0.16, 1, 0.3, 1] as const

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
    <main className="menu-landing">
      <motion.div className="menu-landing__video-wrap" initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.5, ease }}>
        <video src={VIDEO_URL} autoPlay muted playsInline loop preload="auto" aria-hidden="true" />
      </motion.div>
      <div className="menu-landing__wash" aria-hidden="true" />

      <motion.header className="menu-landing__nav" initial={{ y: -16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.8, ease }}>
        <div className="menu-landing__brand"><span aria-hidden="true" /><strong>ForgeCore</strong></div>
        <div className="menu-landing__user">
          <UserRound aria-hidden="true" />
          <strong>{user.displayName}</strong>
          <button type="button" onClick={onLogout} aria-label="退出登录" title="退出登录"><LogOut /></button>
        </div>
      </motion.header>

      <motion.section className="menu-landing__content" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.35, duration: 0.9, ease }}>
        <h1>选择工程</h1>
        <div className="menu-choice-grid">
          <button className="menu-choice menu-choice--primary" type="button" disabled={!hasSavedFactory} onClick={onContinue}>
            <Clock3 /><strong>{hasSavedFactory ? '继续工厂' : '暂无存档'}</strong><ArrowRight />
          </button>
          <button className="menu-choice" type="button" aria-expanded={showCreate} onClick={() => setShowCreate((open) => !open)}>
            <Plus /><strong>新建工厂</strong><ArrowRight />
          </button>
        </div>

        {showCreate && <motion.form className="menu-create-form" onSubmit={create} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.45, ease }}>
          <div className="menu-create-form__heading"><h2>空白工厂</h2><Grid3X3 /></div>
          <div className="menu-create-fields">
            <label><span>工厂名称</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
            <label><span>宽度</span><input type="number" min={12} max={80} value={widthM} onChange={(event) => setWidthM(Number(event.target.value))} required /></label>
            <label><span>长度</span><input type="number" min={12} max={80} value={lengthM} onChange={(event) => setLengthM(Number(event.target.value))} required /></label>
            <label><span>网格</span><select value={gridSizeM} onChange={(event) => setGridSizeM(Number(event.target.value))}><option value={0.5}>0.5 m</option><option value={1}>1 m</option><option value={2}>2 m</option></select></label>
          </div>
          <div className="menu-create-form__footer"><span>{widthM} × {lengthM} m · {Math.round(widthM / gridSizeM) * Math.round(lengthM / gridSizeM)} 格</span><button type="submit">创建并进入<ArrowRight /></button></div>
        </motion.form>}
      </motion.section>
    </main>
  )
}
