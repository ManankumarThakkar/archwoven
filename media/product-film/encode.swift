// macOS offline H.264 export using the system media encoder. No third-party dependencies.
import Foundation
import AVFoundation
import CoreGraphics
import ImageIO

guard (2...3).contains(CommandLine.arguments.count) else { fatalError("Usage: encode <render output directory> [frame count]") }
let directory = URL(fileURLWithPath: CommandLine.arguments[1])
let frameCount = CommandLine.arguments.count == 3 ? Int(CommandLine.arguments[2])! : 960
let output = directory.appendingPathComponent("archwoven-film.mp4")
if FileManager.default.fileExists(atPath: output.path) { try FileManager.default.removeItem(at: output) }
let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
writer.shouldOptimizeForNetworkUse = true
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: 1920, AVVideoHeightKey: 1080,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 1_600_000, AVVideoExpectedSourceFrameRateKey: 30, AVVideoMaxKeyFrameIntervalKey: 60, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel]
])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB, kCVPixelBufferWidthKey as String: 1920, kCVPixelBufferHeightKey as String: 1080, kCVPixelBufferCGImageCompatibilityKey as String: true, kCVPixelBufferCGBitmapContextCompatibilityKey as String: true])
guard writer.canAdd(input) else { fatalError("H.264 video input unavailable") }
writer.add(input)
guard writer.startWriting() else { fatalError("Could not start encoder: \(String(describing: writer.error))") }
writer.startSession(atSourceTime: .zero)
let color = CGColorSpace(name: CGColorSpace.sRGB)!
for frame in 0..<frameCount {
  while !input.isReadyForMoreMediaData {
    if writer.status == .failed { fatalError("Encoder failed: \(String(describing: writer.error))") }
    Thread.sleep(forTimeInterval: 0.002)
  }
  try autoreleasepool {
    let url = directory.appendingPathComponent(String(format: "frames/%05d.jpg", frame))
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw NSError(domain: "Film", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing frame \(frame)"]) }
    var buffer: CVPixelBuffer?
    guard let pool = adaptor.pixelBufferPool, CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let buffer else { fatalError("Pixel buffer unavailable") }
    CVPixelBufferLockBaseAddress(buffer, [])
    guard let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: 1920, height: 1080, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: color, bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) else { fatalError("Frame drawing unavailable") }
    context.draw(image, in: CGRect(x: 0, y: 0, width: 1920, height: 1080))
    CVPixelBufferUnlockBaseAddress(buffer, [])
    guard adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(frame), timescale: 30)) else { fatalError("Could not append frame \(frame): \(String(describing: writer.error))") }
  }
}
input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.endSession(atSourceTime: CMTime(value: Int64(frameCount), timescale: 30))
writer.finishWriting { done.signal() }
done.wait()
guard writer.status == .completed else { fatalError("Export failed: \(String(describing: writer.error))") }
print("Exported \(Double(frameCount)/30)-second 1920×1080 H.264 MP4: \(output.path)")
