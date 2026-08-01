import AppKit
import CoreGraphics
import Foundation
import PDFKit

// 合成 PDF 抽取用的受控 fixture（F4 的 A6 素材）。
//
// 只合成「混合宽高比」这一人为构造的边界：合格页与不合格页交错，用于验逐页判定、
// 跳过报告与页号溯源。**文本层探测（P3）不用合成件验**——合成件带着我们自己的假设，
// `hasExtractableText` 只有在真实导出的 PDF 上才有意义。

private struct PageSpec {
    let widthPt: CGFloat
    let heightPt: CGFloat
    let title: String
    let body: String
    /// 不画任何文字：用来产出 `hasExtractableText == false` 的一页。
    let withText: Bool
}

private let a4Long: CGFloat = 841.89
private let a4Short: CGFloat = 595.28

private let mixedPages: [PageSpec] = [
    PageSpec(
        widthPt: 720,
        heightPt: 405,
        title: "第一页 16:9 合格页",
        body: "720 × 405 pt · 应当被建立为 deck 内第 1 页",
        withText: true
    ),
    PageSpec(
        widthPt: a4Long,
        heightPt: a4Short,
        title: "第二页 A4 横版",
        body: "841.89 × 595.28 pt · 非 16:9，应当被跳过并进入报告",
        withText: true
    ),
    PageSpec(
        widthPt: 960,
        heightPt: 540,
        title: "第三页 16:9 合格页",
        body: "960 × 540 pt · 页号溯源应指向 PDF 原始第 3 页",
        withText: true
    ),
    PageSpec(
        widthPt: a4Short,
        heightPt: a4Long,
        title: "第四页 A4 竖版",
        body: "595.28 × 841.89 pt · 非 16:9，应当被跳过并进入报告",
        withText: true
    ),
    PageSpec(
        widthPt: 720,
        heightPt: 405,
        title: "",
        body: "",
        // 纯图形页：探测应得 hasExtractableText == false
        withText: false
    ),
]

private let noWidePages: [PageSpec] = [
    PageSpec(
        widthPt: a4Long,
        heightPt: a4Short,
        title: "全篇无 16:9 页 · 第一页",
        body: "抽取应整体失败且不留下半成品 deck",
        withText: true
    ),
    PageSpec(
        widthPt: a4Short,
        heightPt: a4Long,
        title: "全篇无 16:9 页 · 第二页",
        body: "抽取应整体失败且不留下半成品 deck",
        withText: true
    ),
]

private func draw(page: PageSpec, index: Int, in context: CGContext) {
    let bounds = CGRect(x: 0, y: 0, width: page.widthPt, height: page.heightPt)

    let graphics = NSGraphicsContext(cgContext: context, flipped: false)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphics

    NSColor(calibratedRed: 0.97, green: 0.98, blue: 1.0, alpha: 1).setFill()
    bounds.fill()

    NSColor(calibratedRed: 0.15, green: 0.43, blue: 0.95, alpha: 1).setFill()
    NSRect(
        x: bounds.width * 0.06,
        y: bounds.height * 0.72,
        width: bounds.width * 0.88,
        height: bounds.height * 0.06
    ).fill()

    NSColor(calibratedRed: 0.85, green: 0.90, blue: 0.98, alpha: 1).setFill()
    NSBezierPath(
        roundedRect: NSRect(
            x: bounds.width * 0.06,
            y: bounds.height * 0.12,
            width: bounds.width * 0.40,
            height: bounds.height * 0.48
        ),
        xRadius: 12,
        yRadius: 12
    ).fill()

    if page.withText {
        let title: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: bounds.height * 0.075, weight: .bold),
            .foregroundColor: NSColor(calibratedRed: 0.06, green: 0.12, blue: 0.24, alpha: 1),
        ]
        let body: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: bounds.height * 0.042, weight: .regular),
            .foregroundColor: NSColor(calibratedRed: 0.20, green: 0.26, blue: 0.36, alpha: 1),
        ]
        (page.title as NSString).draw(
            in: NSRect(
                x: bounds.width * 0.06,
                y: bounds.height * 0.83,
                width: bounds.width * 0.88,
                height: bounds.height * 0.11
            ),
            withAttributes: title
        )
        (page.body as NSString).draw(
            in: NSRect(
                x: bounds.width * 0.06,
                y: bounds.height * 0.62,
                width: bounds.width * 0.88,
                height: bounds.height * 0.08
            ),
            withAttributes: body
        )
    } else {
        NSColor(calibratedRed: 0.95, green: 0.55, blue: 0.20, alpha: 1).setFill()
        NSBezierPath(
            ovalIn: NSRect(
                x: bounds.width * 0.56,
                y: bounds.height * 0.22,
                width: bounds.width * 0.30,
                height: bounds.height * 0.42
            )
        ).fill()
    }

    NSGraphicsContext.restoreGraphicsState()
    _ = index
}

private func writePdf(pages: [PageSpec], to url: URL) throws {
    guard let first = pages.first else {
        throw NSError(domain: "generate-test-pdf", code: 1)
    }
    var mediaBox = CGRect(x: 0, y: 0, width: first.widthPt, height: first.heightPt)
    guard let context = CGContext(url as CFURL, mediaBox: &mediaBox, nil) else {
        throw NSError(domain: "generate-test-pdf", code: 2)
    }
    for (index, page) in pages.enumerated() {
        var box = CGRect(x: 0, y: 0, width: page.widthPt, height: page.heightPt)
        let boxData = Data(bytes: &box, count: MemoryLayout<CGRect>.size)
        context.beginPDFPage([kCGPDFContextMediaBox as String: boxData] as CFDictionary)
        draw(page: page, index: index, in: context)
        context.endPDFPage()
    }
    context.closePDF()
}

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("用法：generate-test-pdf.swift <output-dir>\n".utf8))
    exit(1)
}

let outputDirectory = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

let mixedURL = outputDirectory.appendingPathComponent("mixed-aspect.pdf")
let noWideURL = outputDirectory.appendingPathComponent("no-wide.pdf")
try writePdf(pages: mixedPages, to: mixedURL)
try writePdf(pages: noWidePages, to: noWideURL)

// 需要用户口令才能打开的 PDF：抽取应直接报错退出，不做交互解锁。
let lockedURL = outputDirectory.appendingPathComponent("password-protected.pdf")
guard let source = PDFDocument(url: mixedURL),
    source.write(
        to: lockedURL,
        withOptions: [
            .userPasswordOption: "ppt-maker",
            .ownerPasswordOption: "ppt-maker-owner",
        ]
    )
else {
    FileHandle.standardError.write(Data("无法生成加密 PDF fixture\n".utf8))
    exit(1)
}

print(mixedURL.path)
print(noWideURL.path)
print(lockedURL.path)
