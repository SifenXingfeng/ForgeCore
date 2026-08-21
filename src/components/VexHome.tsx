import { useEffect, useRef } from 'react'
import { animate, stagger } from 'animejs'

type VexHomeProps = {
  onEnterWorkspace: () => void
}

const headingLines = ['让工厂，', '先在数字世界里运行。']

function AnimatedHeading() {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const characters = Array.from(headingRef.current?.querySelectorAll<HTMLElement>('.vex-heading-char') ?? [])
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      characters.forEach((character) => { character.style.opacity = '1' })
      return
    }

    characters.forEach((character) => {
      const lineIndex = Number(character.dataset.line ?? 0)
      const charIndex = Number(character.dataset.char ?? 0)
      const lineLength = Number(character.dataset.length ?? 0)
      animate(character, {
        opacity: [0, 1],
        translateX: [-18, 0],
        delay: 200 + (lineIndex * lineLength * 30) + (charIndex * 30),
        duration: 500,
        ease: 'out(3)',
      })
    })
  }, [])

  return (
    <h1 ref={headingRef} className="vex-heading">
      {headingLines.map((line, lineIndex) => (
        <span className="vex-heading-line" key={line}>
          {Array.from(line).map((character, charIndex) => (
            <span
              className="vex-heading-char"
              data-line={lineIndex}
              data-char={charIndex}
              data-length={line.length}
              key={`${lineIndex}-${charIndex}`}
            >
              {character === ' ' ? '\u00a0' : character}
            </span>
          ))}
          {lineIndex < headingLines.length - 1 && <br />}
        </span>
      ))}
    </h1>
  )
}

export function VexHome({ onEnterWorkspace }: VexHomeProps) {
  const homeRef = useRef<HTMLDivElement>(null)

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const root = homeRef.current
    if (!root) return

    const subheading = root.querySelector('.vex-subheading')
    if (subheading) {
      animate(subheading, {
        opacity: [0, 1],
        translateY: [18, 0],
        delay: 800,
        duration: 1000,
        ease: 'out(4)',
      })
    }
    animate(root.querySelectorAll('.vex-action'), {
      opacity: [0, 1],
      translateY: [18, 0],
      delay: stagger(110, { start: 1200 }),
      duration: 1000,
      ease: 'out(4)',
    })
    const tag = root.querySelector('.vex-tag')
    if (tag) {
      animate(tag, {
        opacity: [0, 1],
        translateX: [22, 0],
        delay: 1400,
        duration: 1000,
        ease: 'out(4)',
      })
    }
    animate(root.querySelectorAll('.vex-nav-item'), {
      opacity: [0, 1],
      translateY: [-12, 0],
      delay: stagger(70, { start: 180 }),
      duration: 680,
      ease: 'out(4)',
    })

    const revealTargets = Array.from(root.querySelectorAll<HTMLElement>('.vex-reveal'))
    revealTargets.forEach((element) => {
      element.style.opacity = '0'
      element.style.transform = 'translateY(34px)'
    })
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        const element = entry.target as HTMLElement
        animate(element, {
          opacity: [0, 1],
          translateY: [34, 0],
          duration: 820,
          ease: 'out(4)',
        })
        const children = Array.from(element.querySelectorAll<HTMLElement>('.vex-reveal-item'))
        if (children.length) {
          animate(children, {
            opacity: [0, 1],
            translateY: [18, 0],
            delay: stagger(90, { start: 120 }),
            duration: 620,
            ease: 'out(4)',
          })
        }
        observer.unobserve(element)
      })
    }, { root, threshold: 0.15 })
    revealTargets.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [])

  return (
    <div className="vex-home" ref={homeRef}>
      <video className="vex-video" autoPlay loop muted playsInline preload="auto" aria-hidden="true">
        <source src="/videos/vex-hero.mp4" type="video/mp4" />
      </video>

      <header className="vex-header">
        <button className="vex-logo vex-nav-item" type="button" onClick={() => homeRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="返回 ForgeMind 首页">
          <img src="/brand/forgemind-wordmark.png" alt="ForgeMind" />
        </button>
        <nav className="vex-nav" aria-label="官网导航">
          <a className="vex-nav-item" href="#product">产品工业</a>
          <a className="vex-nav-item" href="#technology">技术核心</a>
          <a className="vex-nav-item" href="#docs">文档发布</a>
          <a className="vex-nav-item" href="#about">关于 ForgeMind</a>
        </nav>
        <button className="vex-chat vex-nav-item" type="button" onClick={onEnterWorkspace}>进入工作台</button>
      </header>

      <main className="vex-hero-content" id="vex-home">
        <div className="vex-copy">
          <AnimatedHeading />
          <p className="vex-subheading">AI 驱动的智能工厂数字孪生平台。用空间设计生产，用仿真验证生产，用信号优化生产。</p>
          <div className="vex-actions">
            <button className="vex-action vex-button vex-button-primary" type="button" onClick={onEnterWorkspace}>进入数字工厂</button>
            <button className="vex-action vex-button vex-button-glass" type="button" onClick={() => scrollTo('product')}>查看平台能力</button>
          </div>
        </div>
        <div className="vex-tag-wrap">
          <div className="vex-tag vex-liquid-glass">设计 · 仿真 · 优化</div>
        </div>
      </main>

      <section className="vex-intro vex-product-section vex-reveal" id="product">
        <div className="vex-section-kicker vex-reveal-item"><span>01</span> / INDUSTRIAL PRODUCT</div>
        <div className="vex-section-heading vex-reveal-item">
          <h2>把工厂带进<br /><em>数字世界。</em></h2>
          <p>ForgeMind 将空间设计、生产仿真、视觉检测和运行诊断放进同一套可操作的数字工厂里，让方案在落地之前就能被看见、被验证、被迭代。</p>
        </div>
        <div className="vex-product-grid">
          <div className="vex-product-screen vex-reveal-item">
            <img src="/photos/1.png" alt="ForgeMind 数字孪生工厂总览" />
            <div className="vex-screen-mark"><span>LIVE VIEW</span><strong>A-01 / DIGITAL TWIN</strong></div>
            <div className="vex-screen-corner vex-screen-corner-tl" /><div className="vex-screen-corner vex-screen-corner-br" />
          </div>
          <div className="vex-product-list">
            <article className="vex-product-item vex-reveal-item"><span>FM / 01</span><div><h3>网格建造</h3><p>拖拽放置设备、传送带和原料入口，在统一坐标里规划完整产线。</p></div><b>↗</b></article>
            <article className="vex-product-item vex-reveal-item"><span>FM / 02</span><div><h3>生产仿真</h3><p>用固定步长和逻辑时钟让物料跑起来，观察节拍、堵塞与实时产出。</p></div><b>↗</b></article>
            <article className="vex-product-item vex-reveal-item"><span>FM / 03</span><div><h3>AI 工厂诊断</h3><p>聚焦瓶颈、设备利用率和物流负载，把下一次优化变成有依据的动作。</p></div><b>↗</b></article>
          </div>
        </div>
      </section>

      <section className="vex-intro vex-technology-section vex-reveal" id="technology">
        <div className="vex-section-kicker vex-reveal-item"><span>02</span> / TECHNICAL CORE</div>
        <div className="vex-section-heading vex-reveal-item">
          <h2>一条产线的背后，<br /><em>是一套确定的系统。</em></h2>
          <p>从数据结构到渲染画面，从仿真内核到 AI 工具协议，ForgeMind 让每一次运行都可复现、可解释、可扩展。</p>
        </div>
        <div className="vex-core-map vex-reveal-item">
          <div className="vex-core-line vex-core-line-a" /><div className="vex-core-line vex-core-line-b" />
          <div className="vex-core-node vex-core-node-a"><span>01</span><strong>SPACE</strong><small>空间与设备</small></div>
          <div className="vex-core-node vex-core-node-b"><span>02</span><strong>FLOW</strong><small>物料与仿真</small></div>
          <div className="vex-core-node vex-core-node-c"><span>03</span><strong>SIGNAL</strong><small>诊断与决策</small></div>
          <div className="vex-core-center"><span>FM-OS</span><strong>DIGITAL<br />FACTORY</strong><small>DETERMINISTIC / AI READY</small></div>
        </div>
        <div className="vex-tech-cards">
          <article className="vex-tech-card vex-reveal-item"><span>ENGINE / 01</span><h3>纯 TS 仿真内核</h3><p>React 与 Three.js 只负责交互和渲染，生产逻辑保持独立、稳定、可回归。</p></article>
          <article className="vex-tech-card vex-reveal-item"><span>PROTOCOL / 02</span><h3>AI 工具协议</h3><p>让本地模型理解工厂对象、生产动作与诊断结果，形成可控的操作闭环。</p></article>
          <article className="vex-tech-card vex-reveal-item"><span>VISION / 03</span><h3>视觉检测工作台</h3><p>虚拟相机、OpenCV 检测和语音播报共同组成面向现场的质检链路。</p></article>
        </div>
      </section>

      <section className="vex-intro vex-docs-section vex-reveal" id="docs">
        <div className="vex-section-kicker vex-reveal-item"><span>03</span> / DOCUMENT RELEASES</div>
        <div className="vex-section-heading vex-reveal-item">
          <h2>每一次构建，<br /><em>都有迹可循。</em></h2>
          <p>从项目方案到接入说明，文档和版本一起发布，让团队可以沿着同一条技术路线继续往前。</p>
        </div>
        <div className="vex-docs-grid">
          <article className="vex-doc-card vex-doc-card-featured vex-reveal-item"><span>DESIGN / 2026.08</span><h3>AI 驱动的智能工厂数字孪生设计方案</h3><p>产品愿景、核心模块、仿真模型和演示闭环的完整说明。</p><b>阅读方案 ↗</b></article>
          <article className="vex-doc-card vex-reveal-item"><span>TECH / CURRENT</span><h3>功能模块技术文档</h3><p>对象、配方、生产链、仿真控制和状态面板。</p><b>查看文档 ↗</b></article>
          <article className="vex-doc-card vex-reveal-item"><span>INTEGRATION / API</span><h3>智能管家工具协议</h3><p>AI 如何读取、调用并反馈工厂操作。</p><b>查看协议 ↗</b></article>
          <article className="vex-doc-card vex-reveal-item"><span>RELEASE / 0.1.0</span><h3>ForgeMind 当前版本</h3><p>网格建造、仿真运行、视觉检测和语音交互。</p><b>版本记录 ↗</b></article>
        </div>
      </section>

      <section className="vex-about-section vex-reveal" id="about">
        <div className="vex-about-copy"><span className="vex-section-kicker"><span>04</span> / ABOUT FORGEMIND</span><h2>让每一座工厂，<br />先运行在更好的答案里。</h2><p>ForgeMind 面向智能制造的设计者、工程师和运营者，让复杂的生产系统有一张可以共同理解的地图。</p><button className="vex-button vex-button-primary" type="button" onClick={onEnterWorkspace}>进入数字工厂 <b>↗</b></button></div>
        <div className="vex-about-readout"><strong>FM-OS</strong><span>SMART MANUFACTURING PLATFORM</span><i /><small>BUILD 0.1.0 / A-01 / ONLINE</small></div>
      </section>

      <footer className="vex-footer"><span>FORGEMIND / DIGITAL FACTORY 01</span><span>DESIGN · SIMULATION · SIGNAL</span><span>© 2026 FORGEMIND</span></footer>
    </div>
  )
}
