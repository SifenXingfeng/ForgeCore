import { useEffect, useRef, useState } from 'react'
import { animate, stagger } from 'animejs'

type ForgeMindIntroProps = {
  onEnterWorkspace: () => void
}

const sections = [
  { id: 'intro-product', label: '产品工业' },
  { id: 'intro-technology', label: '技术核心' },
  { id: 'intro-workflow', label: '运行流程' },
  { id: 'intro-docs', label: '文档发布' },
]

const products = [
  { code: '01', title: '网格建造', note: 'SPACE / EDIT', body: '从空白工厂区域开始，按统一网格放置机器、传送带和原料入口。', metric: 'GRID 1M', image: '/photos/1.png' },
  { code: '02', title: '生产仿真', note: 'FLOW / RUN', body: '用固定步长、逻辑时钟和真实物料流，验证生产节拍与物流连接。', metric: 'TICK 60 / S', image: '/video/v5_seg1_mid.jpg' },
  { code: '03', title: '瓶颈诊断', note: 'SIGNAL / READ', body: '聚焦设备利用率、传送带堵塞和实时产出，为下一轮布局优化提供依据。', metric: 'STATUS LIVE', image: '/video/fin_seg3.jpg' },
]

function scrollInto(root: HTMLDivElement | null, id: string) {
  root?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function ForgeMindIntro({ onEnterWorkspace }: ForgeMindIntroProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [activeSection, setActiveSection] = useState('intro-product')

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!reduced) {
      animate(root.querySelectorAll('.fmi-enter'), {
        opacity: [0, 1],
        translateY: [18, 0],
        delay: stagger(70, { start: 120 }),
        duration: 750,
        ease: 'out(4)',
      })
      animate(root.querySelectorAll('.fmi-route-dot'), {
        scale: [0.65, 1],
        opacity: [0.35, 1],
        delay: stagger(180, { start: 380 }),
        duration: 900,
        ease: 'inOut(2)',
        loop: true,
        alternate: true,
      })
    }

    const reveals = Array.from(root.querySelectorAll<HTMLElement>('.fmi-reveal'))
    if (reduced) reveals.forEach((element) => { element.dataset.visible = 'true' })
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        const element = entry.target as HTMLElement
        element.dataset.visible = 'true'
        if (!reduced) {
          animate(element.querySelectorAll('.fmi-reveal-item'), {
            opacity: [0, 1],
            translateY: [16, 0],
            delay: stagger(65, { start: 80 }),
            duration: 620,
            ease: 'out(4)',
          })
        }
        observer.unobserve(element)
      })
    }, { root, threshold: 0.18 })
    reveals.forEach((element) => observer.observe(element))

    const onScroll = () => {
      const marker = root.scrollTop + root.clientHeight * 0.34
      let current = sections[0].id
      sections.forEach(({ id }) => {
        const element = root.querySelector<HTMLElement>(`#${id}`)
        if (element && element.offsetTop <= marker) current = id
      })
      setActiveSection(current)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      observer.disconnect()
      root.removeEventListener('scroll', onScroll)
    }
  }, [])

  return (
    <div className="fmi-page" ref={rootRef}>
      <div className="fmi-grain" aria-hidden="true" />
      <header className="fmi-nav fmi-enter">
        <button className="fmi-brand" type="button" onClick={() => rootRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="返回 ForgeMind 首页">
          <img src="/brand/forgemind-emblem.png" alt="" />
          <span><img src="/brand/forgemind-wordmark.png" alt="ForgeMind" /><small>DIGITAL FACTORY OS</small></span>
        </button>
        <nav aria-label="介绍页导航">
          {sections.map((section) => <button key={section.id} className={activeSection === section.id ? 'is-active' : ''} type="button" onClick={() => scrollInto(rootRef.current, section.id)}>{section.label}</button>)}
        </nav>
        <button className="fmi-nav-cta" type="button" onClick={onEnterWorkspace}><span>01</span>进入工作台 <b>↗</b></button>
      </header>

      <main>
        <section className="fmi-hero" aria-labelledby="fmi-title">
          <div className="fmi-hero-copy">
            <div className="fmi-kicker fmi-enter"><i /> FORGEMIND / A-01 / PRODUCT BRIEF</div>
            <h1 id="fmi-title" className="fmi-title fmi-enter">让工厂<br /><em>先运行</em>在数字世界。</h1>
            <p className="fmi-hero-lede fmi-enter">AI 驱动的智能工厂数字孪生设计与仿真平台。把生产线从一张图，变成一套可以搭建、运行、分析和优化的系统。</p>
            <div className="fmi-hero-actions fmi-enter">
              <button className="fmi-button fmi-button-primary" type="button" onClick={onEnterWorkspace}>进入数字工厂 <b>↗</b></button>
              <button className="fmi-button fmi-button-quiet" type="button" onClick={() => scrollInto(rootRef.current, 'intro-product')}>查看产品能力 <span>↓</span></button>
            </div>
            <div className="fmi-hero-facts fmi-enter">
              <div><strong>1 × 7</strong><span>人 × 天 / MVP 开发约束</span></div>
              <div><strong>3D</strong><span>空间 · 生产 · 信号</span></div>
              <div><strong>0.1.0</strong><span>当前演示版本</span></div>
            </div>
          </div>

          <div className="fmi-hero-media fmi-enter">
            <div className="fmi-media-meta"><span>LIVE SIMULATION / PREVIEW</span><span className="fmi-status"><i /> ONLINE</span></div>
            <div className="fmi-video-frame">
              <video autoPlay loop muted playsInline preload="auto" aria-label="ForgeMind 数字工厂运行预览">
                <source src="/videos/vex-hero.mp4" type="video/mp4" />
              </video>
              <div className="fmi-video-wash" />
              <div className="fmi-scanline" />
              <span className="fmi-corner fmi-corner-tl" /><span className="fmi-corner fmi-corner-br" />
              <div className="fmi-media-readout"><span>FIELD / 3D TWIN</span><strong>RUNNING</strong><small>LOGIC CLOCK 00:01:24</small></div>
            </div>
            <div className="fmi-hero-route"><span>INPUT</span><div className="fmi-route-track"><i /><i /><i /><i /><b /></div><span>OUTPUT</span></div>
          </div>
        </section>

        <div className="fmi-ticker" aria-label="平台能力摘要"><span>DESIGN</span><b>→</b><span>SIMULATE</span><b>→</b><span>ANALYZE</span><b>→</b><span>OPTIMIZE</span><i /> <small>数字生产线设计与仿真平台</small></div>

        <section className="fmi-section fmi-product fmi-reveal" id="intro-product">
          <div className="fmi-section-head fmi-reveal-item"><div className="fmi-section-index">01 / PRODUCT INDUSTRY</div><h2>从空白网格，<br /><span>搭出一条能运行的产线。</span></h2><p>ForgeMind 不只是展示工厂，而是允许你从零设计生产环境：放置设施、连接流程、启动仿真，再根据结果继续修改。</p></div>
          <div className="fmi-product-layout">
            <div className="fmi-product-visual fmi-reveal-item">
              <div className="fmi-visual-top"><span>FACTORY / OVERVIEW</span><span>GRID 16 × 12</span></div>
              <img src="/photos/1.png" alt="ForgeMind 三维数字工厂工作台" />
              <div className="fmi-visual-caption"><strong>从对象开始构建</strong><span>机器 · 传送带 · 物品 · 配方</span></div>
            </div>
            <div className="fmi-product-list">
              {products.map((product) => <article className="fmi-product-card fmi-reveal-item" key={product.code}>
                <div className="fmi-product-thumb"><img src={product.image} alt="" /><span>{product.metric}</span></div>
                <div className="fmi-product-card-copy"><div className="fmi-card-code">FM / {product.code} <span>{product.note}</span></div><h3>{product.title}</h3><p>{product.body}</p></div><b className="fmi-arrow">↗</b>
              </article>)}
            </div>
          </div>
        </section>

        <section className="fmi-section fmi-technology fmi-reveal" id="intro-technology">
          <div className="fmi-section-head fmi-reveal-item"><div className="fmi-section-index">02 / TECHNICAL CORE</div><h2>画面之下，<br /><span>是一套确定的系统。</span></h2><p>数据结构、仿真引擎和三维渲染各司其职。每一件物品都沿着生产网络真实移动，每一次结果都可以解释。</p></div>
          <div className="fmi-blueprint fmi-reveal-item">
            <div className="fmi-blueprint-label">FM-OS / DETERMINISTIC PIPELINE</div>
            <div className="fmi-blueprint-track"><div><span>01</span><strong>SPACE</strong><small>网格与设备</small></div><i /><div><span>02</span><strong>FLOW</strong><small>物料与配方</small></div><i /><div><span>03</span><strong>STATE</strong><small>固定步长仿真</small></div><i /><div><span>04</span><strong>SIGNAL</strong><small>统计与诊断</small></div></div>
            <div className="fmi-blueprint-base"><span>唯一真相源</span><strong>PURE TYPESCRIPT SIMULATION CORE</strong><span>AI READY / TOOL PROTOCOL</span></div>
          </div>
          <div className="fmi-tech-grid">
            <article className="fmi-tech-card fmi-reveal-item"><span>ENGINE / 01</span><h3>仿真内核与渲染解耦</h3><p>纯 TS 引擎负责生产逻辑，React 管 UI，Three.js 管三维画面，高频实体不进入响应式状态。</p><code>src/game/simulation.ts</code></article>
            <article className="fmi-tech-card fmi-reveal-item"><span>STATE / 02</span><h3>可复现的生产状态</h3><p>逻辑时钟、种子化随机数、机器状态机和离散传送带，让堵塞、产出和利用率可回归。</p><code>FIXED STEP / SEEDED PRNG</code></article>
            <article className="fmi-tech-card fmi-reveal-item"><span>AI / 03</span><h3>工具协议连接智能管家</h3><p>AI 可以读取工厂对象、调用生产动作、查看诊断结果，逐步形成可控的优化闭环。</p><code>READ · ACT · REPORT</code></article>
          </div>
        </section>

        <section className="fmi-section fmi-workflow fmi-reveal" id="intro-workflow">
          <div className="fmi-section-head fmi-reveal-item"><div className="fmi-section-index">03 / OPERATING LOOP</div><h2>不是看一张效果图，<br /><span>而是跑完一次生产。</span></h2><p>从放置第一台机器到得到一份优化判断，所有动作都发生在同一张可操作的数字工厂地图里。</p></div>
          <div className="fmi-workflow-list">
            <article className="fmi-step fmi-reveal-item"><span className="fmi-step-number">01</span><div><strong>定义对象</strong><p>建立物品与配方，确定机器的输入、输出和生产时长。</p></div><span className="fmi-step-tag">OBJECT / RECIPE</span></article>
            <article className="fmi-step fmi-reveal-item"><span className="fmi-step-number">02</span><div><strong>连接流程</strong><p>在网格中放置生产设施，用传送带连接成有向生产物流图。</p></div><span className="fmi-step-tag">BUILD / CONNECT</span></article>
            <article className="fmi-step fmi-reveal-item"><span className="fmi-step-number">03</span><div><strong>启动仿真</strong><p>让物品真实沿生产线运输，通过机器发生变化，观察节拍与背压。</p></div><span className="fmi-step-tag">RUN / OBSERVE</span></article>
            <article className="fmi-step fmi-reveal-item"><span className="fmi-step-number">04</span><div><strong>分析优化</strong><p>读取产出、在途、利用率和堵塞信号，验证下一套布局方案。</p></div><span className="fmi-step-tag">READ / IMPROVE</span></article>
          </div>
          <div className="fmi-signal-panel fmi-reveal-item"><div><span>SIMULATION SNAPSHOT</span><strong>FACTORY / A-01</strong></div><div className="fmi-signal-bars"><i style={{ '--bar': '82%' } as React.CSSProperties} /><i style={{ '--bar': '64%' } as React.CSSProperties} /><i style={{ '--bar': '91%' } as React.CSSProperties} /><i style={{ '--bar': '48%' } as React.CSSProperties} /></div><div><span>OUTPUT / MIN</span><strong>+ 24.8</strong></div></div>
        </section>

        <section className="fmi-section fmi-docs fmi-reveal" id="intro-docs">
          <div className="fmi-docs-intro fmi-reveal-item"><div className="fmi-section-index">04 / DOCUMENT RELEASES</div><h2>文档不是附录，<br /><span>是系统的一部分。</span></h2><p>项目方案、功能模块和智能管家协议同步记录产品边界，让每一个构建决定都有迹可循。</p><button className="fmi-button fmi-button-dark" type="button" onClick={onEnterWorkspace}>打开工作台 <b>↗</b></button></div>
          <div className="fmi-doc-table fmi-reveal-item">
            <div className="fmi-doc-row fmi-doc-header"><span>TYPE</span><span>DOCUMENT</span><span>STATUS</span></div>
            <div className="fmi-doc-row"><span>PLAN / 01</span><strong>AI 驱动的智能工厂数字孪生设计方案</strong><em>READ ↗</em></div>
            <div className="fmi-doc-row"><span>TECH / 02</span><strong>功能模块技术文档</strong><em>ACTIVE ↗</em></div>
            <div className="fmi-doc-row"><span>API / 03</span><strong>智能管家工具协议</strong><em>ACTIVE ↗</em></div>
            <div className="fmi-doc-row"><span>RELEASE / 04</span><strong>ForgeMind v0.1.0</strong><em>ONLINE ↗</em></div>
            <div className="fmi-doc-foot"><span>README / BUILD LOG</span><span>4 RECORDS / AUG 2026</span></div>
          </div>
        </section>

        <section className="fmi-cta fmi-reveal" id="intro-about">
          <div className="fmi-cta-label">FORGEMIND / DIGITAL FACTORY OS</div><h2>让每一个生产决定，<br /><em>先被验证。</em></h2><p>进入 A-01 数字工厂，开始搭建你的第一条产线。</p><button className="fmi-button fmi-button-primary" type="button" onClick={onEnterWorkspace}>进入数字工厂 <b>↗</b></button>
          <div className="fmi-cta-readout"><span>BUILD</span><strong>0.1.0</strong><span>STATUS</span><strong className="is-online">● ONLINE</strong><span>CORE</span><strong>TS / R3F / AI</strong></div>
        </section>
      </main>
      <footer className="fmi-footer"><span>FORGEMIND / A-01</span><span>DESIGN · SIMULATION · SIGNAL</span><span>© 2026 FORGEMIND</span></footer>
    </div>
  )
}
