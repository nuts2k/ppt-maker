import Foundation
import ImageIO
import Vision

private let schemaVersion = 1

private struct BoundingBoxPx: Encodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

private struct PointPx: Encodable {
    let x: Double
    let y: Double
}

/// 字符或子串级别的定位提示。仅用于下游 mask 局部分割的先验，
/// 不是精确字形轮廓，也不承诺覆盖每一个字符。
private struct GlyphHint: Encodable {
    let text: String
    /// 源图像素坐标系（左上角原点），四点顺序固定为左上、右上、右下、左下。
    let quadPx: [PointPx]
}

private struct ImageInfo: Encodable {
    let width: Int
    let height: Int
}

private struct RecognizedBlock: Encodable {
    let id: String
    let text: String
    let bboxPx: BoundingBoxPx
    let confidence: Float
    let rotationDeg: Double?
    let glyphHints: [GlyphHint]

    private enum CodingKeys: String, CodingKey {
        case id
        case text
        case bboxPx
        case confidence
        case rotationDeg
        case glyphHints
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(text, forKey: .text)
        try container.encode(bboxPx, forKey: .bboxPx)
        try container.encode(confidence, forKey: .confidence)
        if let rotationDeg {
            try container.encode(rotationDeg, forKey: .rotationDeg)
        } else {
            try container.encodeNil(forKey: .rotationDeg)
        }
        try container.encode(glyphHints, forKey: .glyphHints)
    }
}

private struct ProbeResponse: Encodable {
    let schemaVersion: Int
    let provider: String
    let image: ImageInfo
    let blocks: [RecognizedBlock]
}

private enum ProbeError: LocalizedError {
    case missingImageArgument
    case unreadableImage(String)
    case noImageFrame(String)

    var errorDescription: String? {
        switch self {
        case .missingImageArgument:
            return "用法：macos-vision-ocr <image-path>"
        case .unreadableImage(let path):
            return "无法读取图片：\(path)"
        case .noImageFrame(let path):
            return "图片没有可读取的帧：\(path)"
        }
    }
}

private func loadImage(path: String) throws -> CGImage {
    let url = URL(fileURLWithPath: path) as CFURL
    guard let source = CGImageSourceCreateWithURL(url, nil) else {
        throw ProbeError.unreadableImage(path)
    }
    guard let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw ProbeError.noImageFrame(path)
    }
    return image
}

/// 将 Vision 归一化坐标（左下角原点，y 向上）转换为源图像素坐标（左上角原点）。
private func toPixel(_ point: CGPoint, width: Double, height: Double) -> PointPx {
    let x = min(max(point.x * width, 0), width)
    let y = min(max((1 - point.y) * height, 0), height)
    return PointPx(x: x, y: y)
}

/// 逐字符查询 Vision 的子串框，产出定位提示。Vision 官方说明字符框仅适合 UI 场景，
/// 不适合直接图像处理，因此这里只作为下游局部分割的先验，不承诺是精确字形。
private func glyphHints(
    from candidate: VNRecognizedText,
    width: Double,
    height: Double
) -> [GlyphHint] {
    let string = candidate.string
    var hints: [GlyphHint] = []
    var index = string.startIndex
    while index < string.endIndex {
        let next = string.index(after: index)
        let fragment = String(string[index ..< next])
        defer { index = next }
        if fragment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            continue
        }
        guard let observation = try? candidate.boundingBox(for: index ..< next) else {
            continue
        }
        hints.append(
            GlyphHint(
                text: fragment,
                quadPx: [
                    toPixel(observation.topLeft, width: width, height: height),
                    toPixel(observation.topRight, width: width, height: height),
                    toPixel(observation.bottomRight, width: width, height: height),
                    toPixel(observation.bottomLeft, width: width, height: height),
                ]
            )
        )
    }
    return hints
}

private func recognize(image: CGImage) throws -> [RecognizedBlock] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["zh-Hans", "en-US"]

    let handler = VNImageRequestHandler(cgImage: image, orientation: .up)
    try handler.perform([request])

    let width = Double(image.width)
    let height = Double(image.height)

    let observations = (request.results ?? []).compactMap { observation -> (VNRecognizedText, CGRect)? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return (candidate, observation.boundingBox)
    }
    .sorted { lhs, rhs in
        let lhsTop = 1 - lhs.1.origin.y - lhs.1.height
        let rhsTop = 1 - rhs.1.origin.y - rhs.1.height
        if abs(lhsTop - rhsTop) > 0.01 {
            return lhsTop < rhsTop
        }
        return lhs.1.origin.x < rhs.1.origin.x
    }

    return observations.enumerated().map { index, item in
        let (candidate, box) = item
        return RecognizedBlock(
            id: "vision-\(index)",
            text: candidate.string,
            bboxPx: BoundingBoxPx(
                x: box.origin.x * width,
                y: (1 - box.origin.y - box.height) * height,
                width: box.width * width,
                height: box.height * height
            ),
            confidence: candidate.confidence,
            rotationDeg: nil,
            glyphHints: glyphHints(from: candidate, width: width, height: height)
        )
    }
}

do {
    guard CommandLine.arguments.count == 2 else {
        throw ProbeError.missingImageArgument
    }

    let image = try loadImage(path: CommandLine.arguments[1])
    let response = ProbeResponse(
        schemaVersion: schemaVersion,
        provider: "apple-vision",
        image: ImageInfo(width: image.width, height: image.height),
        blocks: try recognize(image: image)
    )

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    let data = try encoder.encode(response)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    let message = error.localizedDescription
    FileHandle.standardError.write(Data("错误：\(message)\n".utf8))
    exit(1)
}
