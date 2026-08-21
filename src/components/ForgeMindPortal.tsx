import { useEffect, useState } from 'react'
import { animate, stagger } from 'animejs'

type ForgeMindPortalProps = {
  onEnterWorkspace: () => void
}

const capabilityCards = [
  {
    code: 'FM / 01',
    eyebrow: 'DESIGN THE LINE',
    title: '先把工厂搭进数字世界',
    body: '在可视化网格里规划设备、物流和产线节拍，方案在落地前就能被看见。',
    metric: 'BUILD / GRID',
  },
  {
    code: 'FM / 02',
    eyebrow: 'RUN THE FLOW',
    title: '让每一件物料都有路径',
    body: '从原料入口到成品出口，沿着真实连接关系运行生产链，观察每一次堵塞与产出。',
    metric: 'SIM / LIVE',
  },
  {
    code: 'FM / 03',
    eyebrow: 'READ THE SIGNAL',
    title: '用数据找到下一步动作',
    body: '设备利用率、物流负载与瓶颈被统一放进一套实时诊断视角，优化不再靠猜。',
    metric: 'AI / DIAG',
  },
]

const flowSteps = [
  { index: '01', title: '规划', text: '把复杂的车间结构拆成可以操作的空间、设备和连接。' },
  { index: '02', title: '仿真', text: '让物料在数字产线上跑起来，先验证节拍，再交付现场。' },
  { index: '03', title: '优化', text: '把每一次运行沉淀成诊断信号，持续逼近更好的生产状态。' },
]

const archiveItems = [
  { label: 'FACTORY / 01', title: '从一张网格开始', image: '/video/fin_seg3.jpg' },
  { label: 'FLOW / 02', title: '沿着产线看见节拍', image: '/video/v5_seg1_mid.jpg' },
  { label: 'SIGNAL / 03', title: '把瓶颈变成下一步', image: '/video/v5_seg2_3.jpg' },
]

export function ForgeMindPortal({ onEnterWorkspace }: ForgeMindPortalProps) {
  const [activeCapability, setActiveCapability] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    animate('.fm-portal-nav', {
      opacity: [0, 1],
      translateY: [-18, 0],
      duration: 720,
      ease: 'out(4)',
    })
    animate('.fm-portal-hero-copy > *, .fm-portal-hero-visual', {
      opacity: [0, 1],
      translateY: [28, 0],
      delay: stagger(110, { start: 120 }),
      duration: 900,
      ease: 'out(4)',
    })
    animate('.fm-map-route', {
      scaleX: [0, 1],
      opacity: [0, 0.9],
      delay: stagger(220, { start: 500 }),
      duration: 1250,
      ease: 'inOut(3)',
    })
    animate('.fm-map-node', {
      scale: [0.72, 1.16],
      opacity: [0.35, 1],
      delay: stagger(260, { start: 900 }),
      duration: 1050,
      loop: true,
      alternate: true,
      ease: 'inOutSine',
    })
    animate('.fm-portal-visual-frame', {
      translateY: [0, -8],
      rotate: [2.6, 1.8],
      duration: 3600,
      loop: true,
      alternate: true,
      ease: 'inOutSine',
    })
    animate('.fm-portal-hero-grid', {
      backgroundPosition: ['0 0', '70px 70px'],
      duration: 9000,
      loop: true,
      ease: 'linear',
    })
    animate('.fm-portal-online i', {
      scale: [1, 1.65],
      opacity: [0.55, 1],
      duration: 1200,
      loop: true,
      alternate: true,
      ease: 'inOutSine',
    })

    const portal = document.querySelector<HTMLElement>('.fm-portal')
    const revealTargets = Array.from(document.querySelectorAll<HTMLElement>('.fm-portal-reveal'))
    if (!portal || !revealTargets.length) return

    revealTargets.forEach((element) => {
      element.style.opacity = '0'
      element.style.transform = 'translateY(28px)'
    })

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        const element = entry.target as HTMLElement
        animate(element, {
          opacity: [0, 1],
          translateY: [28, 0],
          duration: 820,
          ease: 'out(4)',
        })
        const nestedItems = Array.from(element.querySelectorAll<HTMLElement>('.fm-portal-flow-step, .fm-portal-archive-card, .fm-portal-capability-tab'))
        if (nestedItems.length) {
          animate(nestedItems, {
            opacity: [0, 1],
            translateY: [18, 0],
            delay: stagger(105, { start: 160 }),
            duration: 620,
            ease: 'out(4)',
          })
        }
        observer.unobserve(element)
      })
    }, { root: portal, threshold: 0.16 })

    revealTargets.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    animate('.fm-portal-detail-image, .fm-portal-detail-copy', {
      opacity: [0.2, 1],
      translateX: [16, 0],
      duration: 540,
      delay: stagger(70),
      ease: 'out(4)',
    })
  }, [activeCapability])

  useEffect(() => {
    const portal = document.querySelector<HTMLElement>('.fm-portal')
    const progress = document.querySelector<HTMLElement>('.fm-portal-scroll-progress')
    if (!portal || !progress) return
    const updateProgress = () => {
      const scrollable = portal.scrollHeight - portal.clientHeight
      const ratio = scrollable > 0 ? portal.scrollTop / scrollable : 0
      progress.style.transform = `scaleX(${ratio})`
    }
    portal.addEventListener('scroll', updateProgress, { passive: true })
    updateProgress()
    return () => portal.removeEventListener('scroll', updateProgress)
  }, [])

  const goTo = (id: string) => {
    setMenuOpen(false)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="fm-portal">
      <div className="fm-portal-noise" aria-hidden="true" />
      <div className="fm-portal-scroll-progress" aria-hidden="true" />
      <header className="fm-portal-nav">
        <button className="fm-portal-brand" type="button" onClick={() => goTo('portal-home')} aria-label="返回首页">
          <img src="/brand/forgemind-emblem.png" alt="" />
          <span>
            <img src="/brand/forgemind-wordmark.png" alt="FORGEMIND" />
            <small>SMART MANUFACTURING PLATFORM</small>
          </span>
        </button>
        <nav className={`fm-portal-links ${menuOpen ? 'is-open' : ''}`} aria-label="官网导航">
          <button type="button" onClick={() => goTo('portal-capabilities')}>能力</button>
          <button type="button" onClick={() => goTo('portal-flow')}>运行逻辑</button>
          <button type="button" onClick={() => goTo('portal-archive')}>现场档案</button>
          <button type="button" onClick={() => goTo('portal-about')}>关于 ForgeMind</button>
        </nav>
        <div className="fm-portal-nav-actions">
          <span className="fm-portal-online"><i /> SYSTEM ONLINE</span>
          <button className="fm-portal-enter fm-portal-enter-small" type="button" onClick={onEnterWorkspace}>
            进入工作台 <b>↗</b>
          </button>
          <button className="fm-portal-menu" type="button" onClick={() => setMenuOpen((value) => !value)} aria-label="打开导航菜单" aria-expanded={menuOpen}>
            <span /><span /><span />
          </button>
        </div>
      </header>

      <main>
        <section className="fm-portal-hero" id="portal-home">
          <div className="fm-portal-hero-grid" aria-hidden="true" />
          <div className="fm-portal-hero-map" aria-hidden="true">
            <span className="fm-map-route fm-map-route-a" />
            <span className="fm-map-route fm-map-route-b" />
            <span className="fm-map-node fm-map-node-a" />
            <span className="fm-map-node fm-map-node-b" />
            <span className="fm-map-node fm-map-node-c" />
          </div>
          <div className="fm-portal-hero-copy">
            <div className="fm-portal-kicker"><span>01</span> / DIGITAL FACTORY OPERATING SYSTEM</div>
            <h1>让工厂，<br /><em>先在数字世界里运行。</em></h1>
            <p>ForgeMind 是一套 AI 驱动的智能工厂数字孪生平台。用空间设计生产，用仿真验证生产，用信号优化生产。</p>
            <div className="fm-portal-hero-actions">
              <button className="fm-portal-enter" type="button" onClick={onEnterWorkspace}>进入数字工厂 <b>↗</b></button>
              <button className="fm-portal-text-link" type="button" onClick={() => goTo('portal-capabilities')}>查看平台能力 <span>↓</span></button>
            </div>
          </div>
          <div className="fm-portal-hero-visual">
            <div className="fm-portal-visual-frame">
              <img src="/video/v5_seg2_3.jpg" alt="ForgeMind 工厂产线预览" />
              <div className="fm-portal-visual-scan" />
              <div className="fm-portal-visual-corner fm-portal-visual-corner-tl" />
              <div className="fm-portal-visual-corner fm-portal-visual-corner-br" />
              <div className="fm-portal-visual-label"><span>LIVE PREVIEW</span><strong>A-01 / PRODUCTION LINE</strong></div>
              <div className="fm-portal-visual-readout"><span>FLOW LOAD</span><strong>64<span>%</span></strong><i><b /></i></div>
            </div>
            <div className="fm-portal-hero-caption"><span>SIMULATION / 00:00:21.42</span><span>LAT 31.2304° N / LONG 121.4737° E</span></div>
          </div>
          <div className="fm-portal-hero-footer"><span>SCROLL TO OPERATE</span><i /></div>
        </section>

        <section className="fm-portal-manifesto fm-portal-reveal" id="portal-about">
          <div className="fm-portal-section-label"><span>FM / MANIFESTO</span><i /></div>
          <div className="fm-portal-manifesto-copy">
            <p className="fm-portal-display">生产不是一条<br /><em>黑箱里的流水线。</em></p>
            <p className="fm-portal-body-copy">它是空间、节拍、物料和人的共同决定。ForgeMind 把这些关系放到同一张可操作的地图上，让每次改变都可以被看见、被验证、被复用。</p>
          </div>
          <div className="fm-portal-manifesto-aside"><span>THE FACTORY IS A SYSTEM</span><strong>不是一张静态图，而是一套会回应你的系统。</strong></div>
        </section>

        <section className="fm-portal-capabilities fm-portal-reveal" id="portal-capabilities">
          <div className="fm-portal-section-head">
            <div><span className="fm-portal-kicker"><span>02</span> / CORE CAPABILITIES</span><h2>把工厂拆开，<br /><em>再重新连起来。</em></h2></div>
            <p>从第一块地面网格到一条完整生产链，所有组件都围绕“能运行、可解释、可优化”展开。</p>
          </div>
          <div className="fm-portal-capability-layout">
            <div className="fm-portal-capability-list">
              {capabilityCards.map((card, index) => (
                <button key={card.code} className={`fm-portal-capability-tab ${activeCapability === index ? 'is-active' : ''}`} type="button" onClick={() => setActiveCapability(index)}>
                  <span className="fm-portal-capability-number">{card.code}</span>
                  <span className="fm-portal-capability-title">{card.title}</span>
                  <span className="fm-portal-capability-arrow">↗</span>
                </button>
              ))}
            </div>
            <article className="fm-portal-capability-detail">
              <div className="fm-portal-detail-image"><img src="/photos/1.png" alt="ForgeMind 数字孪生工厂视图" /><div className="fm-portal-detail-overlay" /></div>
              <div className="fm-portal-detail-copy"><div><span>{capabilityCards[activeCapability].eyebrow}</span><strong>{capabilityCards[activeCapability].metric}</strong></div><h3>{capabilityCards[activeCapability].title}</h3><p>{capabilityCards[activeCapability].body}</p></div>
            </article>
          </div>
        </section>

        <section className="fm-portal-flow fm-portal-reveal" id="portal-flow">
          <div className="fm-portal-flow-image"><img src="/video/v5_seg1_mid.jpg" alt="工厂产线与物料流动" /><div className="fm-portal-flow-image-overlay" /><span className="fm-portal-flow-stamp">FIELD<br />NOTE / 03</span></div>
          <div className="fm-portal-flow-copy"><span className="fm-portal-kicker"><span>03</span> / FROM PLAN TO SIGNAL</span><h2>让每一次<br /><em>运行都有答案。</em></h2><p>一条生产线的价值，不只在于它能不能启动，而在于你能不能知道它为什么这样运行。</p><div className="fm-portal-flow-steps">{flowSteps.map((step) => <div className="fm-portal-flow-step" key={step.index}><span>{step.index}</span><div><strong>{step.title}</strong><p>{step.text}</p></div></div>)}</div><button className="fm-portal-text-link" type="button" onClick={onEnterWorkspace}>在工作台里运行一条产线 <span>↗</span></button></div>
        </section>

        <section className="fm-portal-archive fm-portal-reveal" id="portal-archive">
          <div className="fm-portal-section-head fm-portal-archive-head"><div><span className="fm-portal-kicker"><span>04</span> / FIELD ARCHIVE</span><h2>这里没有演示数据。<br /><em>只有正在发生的工厂。</em></h2></div><span className="fm-portal-archive-count">ARCHIVE / 003</span></div>
          <div className="fm-portal-archive-grid">{archiveItems.map((item, index) => <article className={`fm-portal-archive-card fm-portal-archive-card-${index + 1}`} key={item.label}><div className="fm-portal-archive-image"><img src={item.image} alt={item.title} /><span>0{index + 1}</span></div><div className="fm-portal-archive-meta"><span>{item.label}</span><strong>{item.title}</strong><b>↗</b></div></article>)}</div>
        </section>

        <section className="fm-portal-cta fm-portal-reveal">
          <div className="fm-portal-cta-grid" aria-hidden="true" />
          <span className="fm-portal-kicker"><span>05</span> / OPEN THE GATE</span>
          <h2>下一条产线，<br /><em>从这里开始。</em></h2>
          <p>把你的工厂带进 ForgeMind，先在数字世界里跑一遍。</p>
          <button className="fm-portal-enter fm-portal-enter-light" type="button" onClick={onEnterWorkspace}>进入数字工厂 <b>↗</b></button>
        </section>
      </main>

      <footer className="fm-portal-footer"><div className="fm-portal-footer-brand"><img src="/brand/forgemind-emblem.png" alt="" /><span><strong>FORGEMIND</strong><small>SMART MANUFACTURING PLATFORM</small></span></div><div className="fm-portal-footer-meta"><span>FM-OS / A-01</span><span>AI DRIVEN / DIGITAL TWIN</span><span>© 2026 FORGEMIND</span></div></footer>
    </div>
  )
}
