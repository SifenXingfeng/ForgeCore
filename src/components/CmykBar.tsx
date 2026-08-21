/**
 * CMYK 印刷色条 —— 终末地最省成本也最点题的工业印刷符号（§1.3）
 * 一段「青—品红—黄」三色细条，放在面板角落 / 加载页。
 */
export function CmykBar() {
  return (
    <div
      aria-hidden
      className="flex h-[3px] w-full shrink-0"
      style={{
        background:
          'linear-gradient(90deg, #29b6f6 0%, #29b6f6 33.3%, #ec407a 33.3%, #ec407a 66.6%, #fbc02d 66.6%, #fbc02d 100%)',
      }}
    />
  )
}
