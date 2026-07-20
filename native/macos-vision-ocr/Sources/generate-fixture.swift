import AppKit
import Foundation

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("用法：generate-fixture.swift <output.png>\n".utf8))
    exit(1)
}

let outputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let size = NSSize(width: 1600, height: 900)
let image = NSImage(size: size)

image.lockFocus()

NSColor(calibratedRed: 0.08, green: 0.12, blue: 0.22, alpha: 1).setFill()
NSRect(origin: .zero, size: size).fill()

NSColor(calibratedRed: 0.15, green: 0.43, blue: 0.95, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 120, y: 500, width: 1360, height: 230), xRadius: 32, yRadius: 32).fill()

let center = NSMutableParagraphStyle()
center.alignment = .center

let titleAttributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 82, weight: .bold),
    .foregroundColor: NSColor.white,
    .paragraphStyle: center,
]

let subtitleAttributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 48, weight: .medium),
    .foregroundColor: NSColor(calibratedWhite: 0.92, alpha: 1),
    .paragraphStyle: center,
]

("你好，PPT Maker" as NSString).draw(
    in: NSRect(x: 160, y: 575, width: 1280, height: 100),
    withAttributes: titleAttributes
)

("Editable slides · 2026" as NSString).draw(
    in: NSRect(x: 160, y: 320, width: 1280, height: 72),
    withAttributes: subtitleAttributes
)

image.unlockFocus()

guard
    let tiff = image.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiff)
else {
    FileHandle.standardError.write(Data("无法生成图片 fixture\n".utf8))
    exit(1)
}

let isJpeg = ["jpg", "jpeg"].contains(outputURL.pathExtension.lowercased())
let fileType: NSBitmapImageRep.FileType = isJpeg ? .jpeg : .png
let properties: [NSBitmapImageRep.PropertyKey: Any] = isJpeg
    ? [.compressionFactor: 0.92]
    : [:]

guard let data = bitmap.representation(using: fileType, properties: properties) else {
    FileHandle.standardError.write(Data("无法编码图片 fixture\n".utf8))
    exit(1)
}

try FileManager.default.createDirectory(
    at: outputURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
)
try data.write(to: outputURL)
print(outputURL.path)
