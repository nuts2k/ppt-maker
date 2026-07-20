import AppKit
import Foundation

// M1 单页可编辑 PPTX 的合成复杂 fixture 生成器。
// 确定性布局（固定坐标/颜色/字体，无随机），覆盖 implement.md 第 8 节要求的元素类型：
// 中文版式文字、英文/中英混排、容器内文字（卡片/按钮）、
// 对象内符号（仪表 %、徽章 ¥、图表刻度数字）、旋转/艺术字。
// AppKit 坐标系原点在左下角。

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(
        Data("用法：generate-complex-fixture.swift <output.png>\n".utf8))
    exit(1)
}

let outputURL = URL(fileURLWithPath: CommandLine.arguments[1])
// 显式固定像素尺寸，避免 Retina backing scale 导致跨机器输出不一致。
let pixelWidth = 1600
let pixelHeight = 900
let size = NSSize(width: pixelWidth, height: pixelHeight)

func color(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) -> NSColor {
    NSColor(calibratedRed: r, green: g, blue: b, alpha: a)
}

func centeredStyle() -> NSMutableParagraphStyle {
    let style = NSMutableParagraphStyle()
    style.alignment = .center
    return style
}

func draw(
    _ text: String,
    in rect: NSRect,
    size fontSize: Double,
    weight: NSFont.Weight,
    color textColor: NSColor,
    centered: Bool = false
) {
    var attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: fontSize, weight: weight),
        .foregroundColor: textColor,
    ]
    if centered {
        attributes[.paragraphStyle] = centeredStyle()
    }
    (text as NSString).draw(in: rect, withAttributes: attributes)
}

guard
    let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: pixelWidth,
        pixelsHigh: pixelHeight,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .calibratedRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0),
    let context = NSGraphicsContext(bitmapImageRep: bitmap)
else {
    FileHandle.standardError.write(Data("无法创建位图上下文\n".utf8))
    exit(1)
}
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context

// 背景。
color(0.06, 0.10, 0.18).setFill()
NSRect(origin: .zero, size: size).fill()
color(0.09, 0.14, 0.24).setFill()
NSRect(x: 0, y: 760, width: 1600, height: 140).fill()

// 中文版式标题 + 中英混排副标题。
draw(
    "全球营收概览", in: NSRect(x: 96, y: 792, width: 1000, height: 70),
    size: 54, weight: .bold, color: .white)
draw(
    "Global Revenue Overview · 2026 财年 Q2",
    in: NSRect(x: 100, y: 742, width: 1100, height: 40),
    size: 28, weight: .medium, color: color(0.78, 0.84, 0.94))

// 卡片容器 + 容器内中文文字。
let card = NSBezierPath(
    roundedRect: NSRect(x: 96, y: 360, width: 460, height: 300),
    xRadius: 28, yRadius: 28)
color(0.13, 0.20, 0.34).setFill()
card.fill()
draw(
    "核心指标", in: NSRect(x: 132, y: 584, width: 380, height: 44),
    size: 32, weight: .semibold, color: .white)
draw(
    "同比稳步提升，季度环比转正",
    in: NSRect(x: 132, y: 528, width: 400, height: 34),
    size: 22, weight: .regular, color: color(0.72, 0.80, 0.92))
draw(
    "营收 42.6 亿元",
    in: NSRect(x: 132, y: 452, width: 400, height: 48),
    size: 40, weight: .bold, color: color(0.42, 0.78, 0.98))
draw(
    "覆盖 18 个国家与地区",
    in: NSRect(x: 132, y: 400, width: 400, height: 34),
    size: 22, weight: .regular, color: color(0.72, 0.80, 0.92))

// 环形仪表（对象内符号：中心 85%）。
let gaugeCenter = NSPoint(x: 760, y: 520)
let gaugeRadius = 88.0
let track = NSBezierPath()
track.appendArc(
    withCenter: gaugeCenter, radius: gaugeRadius,
    startAngle: 0, endAngle: 360)
track.lineWidth = 24
color(0.20, 0.26, 0.40).setStroke()
track.stroke()
let progress = NSBezierPath()
progress.appendArc(
    withCenter: gaugeCenter, radius: gaugeRadius,
    startAngle: 90, endAngle: 90 - 360 * 0.85, clockwise: true)
progress.lineWidth = 24
color(0.30, 0.82, 0.62).setStroke()
progress.stroke()
draw(
    "85%", in: NSRect(x: gaugeCenter.x - 80, y: gaugeCenter.y - 26, width: 160, height: 52),
    size: 40, weight: .bold, color: .white, centered: true)
draw(
    "达成率", in: NSRect(x: gaugeCenter.x - 80, y: 384, width: 160, height: 30),
    size: 20, weight: .regular, color: color(0.72, 0.80, 0.92), centered: true)

// 柱状图（对象内符号：刻度数字）。
let barBase = 400.0
let barValues = [60.0, 92.0, 74.0, 120.0]
let barColors = [
    color(0.42, 0.62, 0.98), color(0.42, 0.78, 0.98),
    color(0.30, 0.82, 0.62), color(0.96, 0.74, 0.36),
]
for (index, value) in barValues.enumerated() {
    let barX = 940.0 + Double(index) * 62.0
    color(0.20, 0.26, 0.40).setFill()
    NSRect(x: barX, y: barBase, width: 44, height: 160).fill()
    barColors[index].setFill()
    NSRect(x: barX, y: barBase, width: 44, height: value).fill()
    draw(
        String(Int(value)),
        in: NSRect(x: barX - 8, y: barBase + value + 6, width: 60, height: 24),
        size: 18, weight: .semibold, color: .white, centered: true)
}
draw(
    "季度出货（千台）",
    in: NSRect(x: 930, y: 360, width: 300, height: 30),
    size: 20, weight: .regular, color: color(0.72, 0.80, 0.92))

// 货币徽章（对象内符号：¥）。
let badgeCenter = NSPoint(x: 1300, y: 560)
let badge = NSBezierPath(
    ovalIn: NSRect(
        x: badgeCenter.x - 48, y: badgeCenter.y - 48, width: 96, height: 96))
color(0.96, 0.74, 0.36).setFill()
badge.fill()
draw(
    "¥", in: NSRect(x: badgeCenter.x - 48, y: badgeCenter.y - 34, width: 96, height: 64),
    size: 52, weight: .bold, color: color(0.10, 0.12, 0.18), centered: true)
draw(
    "结算币种", in: NSRect(x: 1230, y: 476, width: 240, height: 30),
    size: 20, weight: .regular, color: color(0.72, 0.80, 0.92), centered: true)

// 按钮容器 + 容器内文字。
let button = NSBezierPath(
    roundedRect: NSRect(x: 96, y: 176, width: 300, height: 66),
    xRadius: 33, yRadius: 33)
color(0.24, 0.52, 0.96).setFill()
button.fill()
draw(
    "开始使用 →", in: NSRect(x: 96, y: 194, width: 300, height: 36),
    size: 28, weight: .semibold, color: .white, centered: true)

// 旋转艺术字（旋转文字 / 艺术字）。
context.saveGraphicsState()
let transform = NSAffineTransform()
transform.translateX(by: 1180, yBy: 210)
transform.rotate(byDegrees: 24)
transform.concat()
draw(
    "限时优惠", in: NSRect(x: -160, y: -40, width: 320, height: 80),
    size: 56, weight: .heavy, color: color(0.98, 0.82, 0.42, 0.92), centered: true)
context.restoreGraphicsState()
NSGraphicsContext.restoreGraphicsState()

let isJpeg = ["jpg", "jpeg"].contains(outputURL.pathExtension.lowercased())
let fileType: NSBitmapImageRep.FileType = isJpeg ? .jpeg : .png
let properties: [NSBitmapImageRep.PropertyKey: Any] =
    isJpeg ? [.compressionFactor: 0.92] : [:]

guard let data = bitmap.representation(using: fileType, properties: properties)
else {
    FileHandle.standardError.write(Data("无法编码图片 fixture\n".utf8))
    exit(1)
}

try FileManager.default.createDirectory(
    at: outputURL.deletingLastPathComponent(),
    withIntermediateDirectories: true)
try data.write(to: outputURL)
print(outputURL.path)
