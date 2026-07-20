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

    private enum CodingKeys: String, CodingKey {
        case id
        case text
        case bboxPx
        case confidence
        case rotationDeg
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

private func recognize(image: CGImage) throws -> [RecognizedBlock] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["zh-Hans", "en-US"]

    let handler = VNImageRequestHandler(cgImage: image, orientation: .up)
    try handler.perform([request])

    let width = Double(image.width)
    let height = Double(image.height)

    let observations = (request.results ?? []).compactMap { observation -> (String, Float, CGRect)? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return (candidate.string, candidate.confidence, observation.boundingBox)
    }
    .sorted { lhs, rhs in
        let lhsTop = 1 - lhs.2.origin.y - lhs.2.height
        let rhsTop = 1 - rhs.2.origin.y - rhs.2.height
        if abs(lhsTop - rhsTop) > 0.01 {
            return lhsTop < rhsTop
        }
        return lhs.2.origin.x < rhs.2.origin.x
    }

    return observations.enumerated().map { index, item in
        let (text, confidence, box) = item
        return RecognizedBlock(
            id: "vision-\(index)",
            text: text,
            bboxPx: BoundingBoxPx(
                x: box.origin.x * width,
                y: (1 - box.origin.y - box.height) * height,
                width: box.width * width,
                height: box.height * height
            ),
            confidence: confidence,
            rotationDeg: nil
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
