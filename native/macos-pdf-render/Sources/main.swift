import CoreGraphics
import Foundation
import ImageIO
import PDFKit
import UniformTypeIdentifiers

/// 渲染实现变化（PDFKit 调用方式、色彩空间、背景填充）时递增。
/// 它与运行时 macOS 版本一起构成 `ExtractedSource.rendererVersion`——
/// PDFKit 没有独立版本号，宿主系统版本是「同一页可复现」的唯一锚点。
private let rendererBuildVersion = "1"
private let rendererId = "macos-pdfkit"

private func rendererVersion() -> String {
    let version = ProcessInfo.processInfo.operatingSystemVersion
    return "\(rendererBuildVersion)+macOS-\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
}

private struct ProbePage: Encodable {
    let pageNumber: Int
    let widthPt: Double
    let heightPt: Double
    let hasExtractableText: Bool
}

private struct ProbeResponse: Encodable {
    let rendererId: String
    let rendererVersion: String
    let documentPageCount: Int
    let encrypted: Bool
    let pages: [ProbePage]
}

private struct RenderedPage: Encodable {
    let pageNumber: Int
    let path: String
    let width: Int
    let height: Int
    let renderDpi: Int
}

private struct RenderResponse: Encodable {
    let rendererId: String
    let rendererVersion: String
    let pages: [RenderedPage]
}

private enum RenderError: LocalizedError {
    case usage
    case unreadableDocument(String)
    case lockedDocument(String)
    case missingPage(Int)
    case degeneratePage(Int)
    case contextFailure(Int)
    case encodeFailure(String)
    case invalidTargetWidth(String)
    case invalidPageList(String)

    var errorDescription: String? {
        switch self {
        case .usage:
            return """
            用法：
              macos-pdf-render probe <pdf>
              macos-pdf-render render <pdf> <output-dir> <target-width> [--pages 1,2,5]
            """
        case .unreadableDocument(let path):
            return "无法读取 PDF：\(path)"
        case .lockedDocument(let path):
            return "PDF 需要密码才能打开：\(path)"
        case .missingPage(let number):
            return "PDF 中不存在第 \(number) 页"
        case .degeneratePage(let number):
            return "第 \(number) 页的尺寸不是有效的正数"
        case .contextFailure(let number):
            return "第 \(number) 页创建位图上下文失败"
        case .encodeFailure(let path):
            return "PNG 编码失败：\(path)"
        case .invalidTargetWidth(let value):
            return "目标宽度必须是大于 0 的整数：\(value)"
        case .invalidPageList(let value):
            return "--pages 只接受逗号分隔的正整数页号：\(value)"
        }
    }
}

private struct PageGeometry {
    let widthPt: Double
    let heightPt: Double
}

/// 页面的「视觉」尺寸：mediaBox 经 /Rotate 调整后的宽高。
///
/// 取 `CGPDFPage.getBoxRect` + `rotationAngle` 而不是 `PDFPage.bounds(for:)`——
/// 后者是否把页面旋转算进去在文档上并不明确，而 CGPDFPage 这两个值是无歧义的原始值。
/// 判定 16:9 的是这里的比例（TS 侧完成判定），所以它必须准确。
private func geometry(of ref: CGPDFPage) -> PageGeometry {
    let box = ref.getBoxRect(.mediaBox)
    let rotation = ((Int(ref.rotationAngle) % 360) + 360) % 360
    let swapped = rotation == 90 || rotation == 270
    return PageGeometry(
        widthPt: Double(swapped ? box.height : box.width),
        heightPt: Double(swapped ? box.width : box.height)
    )
}

private func openDocument(path: String) throws -> PDFDocument {
    guard let document = PDFDocument(url: URL(fileURLWithPath: path)) else {
        throw RenderError.unreadableDocument(path)
    }
    return document
}

private func probe(pdfPath: String) throws -> ProbeResponse {
    let document = try openDocument(path: pdfPath)

    // 判据是 `isLocked`（没有密码就读不了内容），不是 `isEncrypted`：
    // 只设了权限口令的 PDF 会被 PDFKit 自动解锁、可以正常渲染，拒绝它是错的。
    if document.isLocked {
        return ProbeResponse(
            rendererId: rendererId,
            rendererVersion: rendererVersion(),
            documentPageCount: document.pageCount,
            encrypted: true,
            pages: []
        )
    }

    var pages: [ProbePage] = []
    for index in 0 ..< document.pageCount {
        guard let page = document.page(at: index), let ref = page.pageRef else {
            throw RenderError.missingPage(index + 1)
        }
        let size = geometry(of: ref)
        // D1：一律位图化，这里只探测并记录文本层可提取性，不消费文本。
        let text = page.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        pages.append(
            ProbePage(
                pageNumber: index + 1,
                widthPt: size.widthPt,
                heightPt: size.heightPt,
                hasExtractableText: !text.isEmpty
            )
        )
    }

    return ProbeResponse(
        rendererId: rendererId,
        rendererVersion: rendererVersion(),
        documentPageCount: document.pageCount,
        encrypted: false,
        pages: pages
    )
}

private func writePng(_ image: CGImage, to url: URL) throws {
    guard
        let destination = CGImageDestinationCreateWithURL(
            url as CFURL,
            UTType.png.identifier as CFString,
            1,
            nil
        )
    else {
        throw RenderError.encodeFailure(url.path)
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        throw RenderError.encodeFailure(url.path)
    }
}

private func render(
    pdfPath: String,
    outputDirectory: String,
    targetWidth: Int,
    pageNumbers: [Int]?
) throws -> RenderResponse {
    let document = try openDocument(path: pdfPath)
    if document.isLocked {
        throw RenderError.lockedDocument(pdfPath)
    }

    let targets = pageNumbers ?? Array(stride(from: 1, through: document.pageCount, by: 1))
    let directory = URL(fileURLWithPath: outputDirectory)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

    var rendered: [RenderedPage] = []
    for number in targets {
        guard
            number >= 1,
            number <= document.pageCount,
            let page = document.page(at: number - 1),
            let ref = page.pageRef
        else {
            throw RenderError.missingPage(number)
        }

        let size = geometry(of: ref)
        guard size.widthPt > 0, size.heightPt > 0 else {
            throw RenderError.degeneratePage(number)
        }

        // F3：固定目标宽度，高度按页面原始比例等比推出。
        let pixelWidth = targetWidth
        let pixelHeight = Int((Double(targetWidth) * size.heightPt / size.widthPt).rounded())
        guard pixelHeight > 0 else {
            throw RenderError.degeneratePage(number)
        }

        guard
            let context = CGContext(
                data: nil,
                width: pixelWidth,
                height: pixelHeight,
                bitsPerComponent: 8,
                bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
            )
        else {
            throw RenderError.contextFailure(number)
        }

        // PDF 页面本身没有背景色，不铺白底会得到黑底。
        let bounds = CGRect(x: 0, y: 0, width: CGFloat(pixelWidth), height: CGFloat(pixelHeight))
        context.setFillColor(gray: 1, alpha: 1)
        context.fill(bounds)
        context.interpolationQuality = .high

        // `getDrawingTransform` 只会把页面缩小以塞进目标矩形，**从不放大**（实测：
        // 直接给它 2048×1152 的矩形，960×540 的页会以 1:1 居中绘制，四周留白）。
        // 因此放大交给 scaleBy，只让它按页面点尺寸算旋转与原点平移。
        let scale = CGFloat(Double(pixelWidth) / size.widthPt)
        let pageRect = CGRect(
            x: 0,
            y: 0,
            width: CGFloat(size.widthPt),
            height: CGFloat(size.heightPt)
        )
        context.saveGState()
        context.scaleBy(x: scale, y: scale)
        context.concatenate(
            ref.getDrawingTransform(.mediaBox, rect: pageRect, rotate: 0, preserveAspectRatio: true)
        )
        context.drawPDFPage(ref)
        context.restoreGState()

        guard let image = context.makeImage() else {
            throw RenderError.contextFailure(number)
        }

        let output = directory.appendingPathComponent(String(format: "page-%03d.png", number))
        try writePng(image, to: output)

        // 反推值：这一页实际相当于按多少 DPI 渲染（F3）。
        let dpi = Int((Double(targetWidth) / (size.widthPt / 72.0)).rounded())
        rendered.append(
            RenderedPage(
                pageNumber: number,
                path: output.path,
                width: image.width,
                height: image.height,
                renderDpi: max(dpi, 1)
            )
        )
    }

    return RenderResponse(
        rendererId: rendererId,
        rendererVersion: rendererVersion(),
        pages: rendered
    )
}

private func parsePageList(_ raw: String) throws -> [Int] {
    let parts = raw.split(separator: ",")
    guard !parts.isEmpty else {
        throw RenderError.invalidPageList(raw)
    }
    var numbers: [Int] = []
    for part in parts {
        let trimmed = part.trimmingCharacters(in: .whitespaces)
        guard let value = Int(trimmed), value >= 1 else {
            throw RenderError.invalidPageList(raw)
        }
        numbers.append(value)
    }
    return numbers
}

private func emit<T: Encodable>(_ value: T) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    let data = try encoder.encode(value)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

do {
    let arguments = Array(CommandLine.arguments.dropFirst())
    guard let command = arguments.first else {
        throw RenderError.usage
    }

    switch command {
    case "probe":
        guard arguments.count == 2 else {
            throw RenderError.usage
        }
        try emit(probe(pdfPath: arguments[1]))
    case "render":
        guard arguments.count >= 4 else {
            throw RenderError.usage
        }
        guard let targetWidth = Int(arguments[3]), targetWidth > 0 else {
            throw RenderError.invalidTargetWidth(arguments[3])
        }
        var pageNumbers: [Int]?
        var index = 4
        while index < arguments.count {
            guard arguments[index] == "--pages", index + 1 < arguments.count else {
                throw RenderError.usage
            }
            pageNumbers = try parsePageList(arguments[index + 1])
            index += 2
        }
        try emit(
            render(
                pdfPath: arguments[1],
                outputDirectory: arguments[2],
                targetWidth: targetWidth,
                pageNumbers: pageNumbers
            )
        )
    default:
        throw RenderError.usage
    }
} catch {
    let message = error.localizedDescription
    FileHandle.standardError.write(Data("错误：\(message)\n".utf8))
    exit(1)
}
