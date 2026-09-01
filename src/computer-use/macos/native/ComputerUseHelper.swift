import Foundation
import AppKit
import ApplicationServices
import CoreGraphics
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

struct HelperFailure: LocalizedError {
    let code: String
    let message: String
    let details: [String: Any]?

    init(_ code: String, _ message: String, details: [String: Any]? = nil) {
        self.code = code
        self.message = message
        self.details = details
    }

    var errorDescription: String? { message }
}

final class ComputerUseHelper {
    private let modifierNames: Set<String> = ["command", "control", "option", "shift", "fn"]

    func handle(action: String, params: [String: Any]) async throws -> Any {
        switch action {
        case "health":
            return ["ready": true, "pid": ProcessInfo.processInfo.processIdentifier]
        case "checkPermissions":
            return checkPermissions(prompt: bool(params, "prompt", default: false))
        case "screenInfo":
            return try screenInfo()
        case "screenshot":
            return try await screenshot(params)
        case "windows":
            return try windows(
                onScreenOnly: bool(params, "onScreenOnly", default: true),
                limit: integer(params, "limit", default: 100)
            )
        case "activeWindow":
            return try activeWindow().map { $0 as Any } ?? NSNull()
        case "mousePosition":
            return pointDictionary(currentMousePosition())
        case "moveMouse":
            try ensureInputPermission()
            let point = try point(params)
            try validate(point)
            try postMouse(type: .mouseMoved, point: point, button: .left)
            return ["completed": true]
        case "click":
            try ensureInputPermission()
            let point = try point(params)
            try validate(point)
            let button = try mouseButton(string(params, "button"))
            let count = integer(params, "clickCount", default: 1)
            try click(point: point, button: button, count: count)
            return ["completed": true]
        case "mouseDown":
            try ensureInputPermission()
            let button = try mouseButton(string(params, "button"))
            try postMouse(type: mouseEventType(button: button, down: true), point: currentMousePosition(), button: button)
            return ["completed": true]
        case "mouseUp":
            try ensureInputPermission()
            let button = try mouseButton(string(params, "button"))
            try postMouse(type: mouseEventType(button: button, down: false), point: currentMousePosition(), button: button)
            return ["completed": true]
        case "drag":
            try ensureInputPermission()
            try drag(params)
            return ["completed": true]
        case "scroll":
            try ensureInputPermission()
            try scroll(deltaX: integer(params, "deltaX", default: 0), deltaY: integer(params, "deltaY"))
            return ["completed": true]
        case "typeText":
            try ensureInputPermission()
            try typeText(string(params, "text"), intervalMs: integer(params, "intervalMs", default: 0))
            return ["completed": true]
        case "key":
            try ensureInputPermission()
            try pressKey(
                string(params, "key"),
                modifiers: stringArray(params, "modifiers")
            )
            return ["completed": true]
        case "hotkey":
            try ensureInputPermission()
            try hotkey(stringArray(params, "keys"))
            return ["completed": true]
        case "accessibilityTree":
            try ensureAccessibilityPermission()
            return try accessibilityTree(
                maxDepth: integer(params, "maxDepth", default: 3),
                maxNodes: integer(params, "maxNodes", default: 200)
            )
        case "focusedElement":
            try ensureAccessibilityPermission()
            return try focusedElement().map { $0 as Any } ?? NSNull()
        default:
            throw HelperFailure("NATIVE_OPERATION_FAILED", "Unknown helper action: \(action)")
        }
    }

    // MARK: - Parameters

    private func bool(_ params: [String: Any], _ key: String, default defaultValue: Bool) -> Bool {
        return params[key] as? Bool ?? defaultValue
    }

    private func integer(_ params: [String: Any], _ key: String, default defaultValue: Int? = nil) -> Int {
        if let value = params[key] as? NSNumber { return value.intValue }
        if let defaultValue { return defaultValue }
        return 0
    }

    private func number(_ params: [String: Any], _ key: String) throws -> Double {
        guard let value = params[key] as? NSNumber else {
            throw HelperFailure("NATIVE_OPERATION_FAILED", "Missing numeric parameter: \(key)")
        }
        return value.doubleValue
    }

    private func string(_ params: [String: Any], _ key: String) -> String {
        return params[key] as? String ?? ""
    }

    private func stringArray(_ params: [String: Any], _ key: String) -> [String] {
        return params[key] as? [String] ?? []
    }

    private func point(_ params: [String: Any]) throws -> CGPoint {
        return CGPoint(x: try number(params, "x"), y: try number(params, "y"))
    }

    private func nestedPoint(_ params: [String: Any], _ key: String) throws -> CGPoint {
        guard let nested = params[key] as? [String: Any] else {
            throw HelperFailure("NATIVE_OPERATION_FAILED", "Missing point parameter: \(key)")
        }
        return try point(nested)
    }

    // MARK: - Permissions

    private func accessibilityTrusted(prompt: Bool) -> Bool {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        return AXIsProcessTrustedWithOptions([key: prompt] as CFDictionary)
    }

    private func checkPermissions(prompt: Bool) -> [String: Any] {
        if prompt && !CGPreflightScreenCaptureAccess() {
            _ = CGRequestScreenCaptureAccess()
        }
        if prompt && !CGPreflightPostEventAccess() {
            _ = CGRequestPostEventAccess()
        }
        let accessibility = accessibilityTrusted(prompt: prompt)
        return [
            "screenRecording": CGPreflightScreenCaptureAccess(),
            "accessibility": accessibility,
            "postEvents": CGPreflightPostEventAccess(),
        ]
    }

    private func ensureScreenPermission() throws {
        if !CGPreflightScreenCaptureAccess() {
            throw HelperFailure(
                "SCREEN_RECORDING_PERMISSION_REQUIRED",
                "Screen Recording permission is required. Open System Settings -> Privacy & Security -> Screen & System Audio Recording and enable the Desktop Commander Computer Use helper."
            )
        }
    }

    private func ensureAccessibilityPermission() throws {
        if !accessibilityTrusted(prompt: false) {
            throw HelperFailure(
                "ACCESSIBILITY_PERMISSION_REQUIRED",
                "Accessibility permission is required. Open System Settings -> Privacy & Security -> Accessibility and enable the Desktop Commander Computer Use helper."
            )
        }
    }

    private func ensureInputPermission() throws {
        if !accessibilityTrusted(prompt: false) && !CGPreflightPostEventAccess() {
            throw HelperFailure(
                "ACCESSIBILITY_PERMISSION_REQUIRED",
                "Accessibility permission is required to post mouse and keyboard events. Open System Settings -> Privacy & Security -> Accessibility and enable the Desktop Commander Computer Use helper."
            )
        }
    }

    // MARK: - Displays and screenshots

    private func activeDisplayIDs() throws -> [CGDirectDisplayID] {
        var count: UInt32 = 0
        var error = CGGetActiveDisplayList(0, nil, &count)
        guard error == .success else {
            throw HelperFailure("NATIVE_OPERATION_FAILED", "Could not enumerate displays (Core Graphics error \(error.rawValue)).")
        }
        var displays = Array(repeating: CGDirectDisplayID(0), count: Int(count))
        error = CGGetActiveDisplayList(count, &displays, &count)
        guard error == .success else {
            throw HelperFailure("NATIVE_OPERATION_FAILED", "Could not read display identifiers (Core Graphics error \(error.rawValue)).")
        }
        return Array(displays.prefix(Int(count)))
    }

    private func screenForDisplay(_ displayID: CGDirectDisplayID) -> NSScreen? {
        return NSScreen.screens.first { screen in
            guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
                return false
            }
            return number.uint32Value == displayID
        }
    }

    private func appKitToCoreGraphics(_ rect: CGRect) -> CGRect {
        let mainHeight = screenForDisplay(CGMainDisplayID())?.frame.height ?? CGDisplayBounds(CGMainDisplayID()).height
        return CGRect(x: rect.origin.x, y: mainHeight - rect.maxY, width: rect.width, height: rect.height)
    }

    private func displayDictionary(_ displayID: CGDirectDisplayID, index: Int) -> [String: Any] {
        let bounds = CGDisplayBounds(displayID)
        let pixelWidth = Int(CGDisplayPixelsWide(displayID))
        let pixelHeight = Int(CGDisplayPixelsHigh(displayID))
        let scaleFactor = bounds.width > 0 ? Double(pixelWidth) / Double(bounds.width) : 1.0
        let visibleFrame = screenForDisplay(displayID).map { appKitToCoreGraphics($0.visibleFrame) } ?? bounds
        return [
            "displayId": Int(displayID),
            "index": index,
            "x": Double(bounds.origin.x),
            "y": Double(bounds.origin.y),
            "width": Double(bounds.width),
            "height": Double(bounds.height),
            "pixelWidth": pixelWidth,
            "pixelHeight": pixelHeight,
            "scaleFactor": scaleFactor,
            "primary": displayID == CGMainDisplayID(),
            "visibleFrame": rectDictionary(visibleFrame),
        ]
    }

    private func screenInfo() throws -> [[String: Any]] {
        return try activeDisplayIDs().enumerated().map { index, displayID in
            displayDictionary(displayID, index: index)
        }
    }

    private func displayID(from params: [String: Any]) throws -> CGDirectDisplayID {
        let requested = params["displayId"] as? NSNumber
        let id = requested.map { CGDirectDisplayID($0.uint32Value) } ?? CGMainDisplayID()
        guard try activeDisplayIDs().contains(id) else {
            throw HelperFailure("INVALID_COORDINATES", "Display \(id) is no longer connected. Refresh with computer_get_screen_info.")
        }
        return id
    }

    @available(macOS 14.0, *)
    private func screenCaptureKitImage(displayID: CGDirectDisplayID, includeCursor: Bool) async throws -> CGImage {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
            throw HelperFailure("NATIVE_OPERATION_FAILED", "ScreenCaptureKit could not find display \(displayID).")
        }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let configuration = SCStreamConfiguration()
        configuration.width = Int(CGDisplayPixelsWide(displayID))
        configuration.height = Int(CGDisplayPixelsHigh(displayID))
        configuration.showsCursor = includeCursor
        return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
    }

    private func legacyDisplayImage(displayID: CGDirectDisplayID) throws -> CGImage {
        guard let image = CGDisplayCreateImage(displayID) else {
            throw HelperFailure("NATIVE_OPERATION_FAILED", "Core Graphics could not capture display \(displayID).")
        }
        return image
    }

    private func pngData(_ image: CGImage) throws -> Data {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
            throw HelperFailure("NATIVE_OPERATION_FAILED", "Could not create a PNG encoder.")
        }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else {
            throw HelperFailure("NATIVE_OPERATION_FAILED", "Could not encode the screenshot as PNG.")
        }
        return data as Data
    }

    private func screenshot(_ params: [String: Any]) async throws -> [String: Any] {
        try ensureScreenPermission()
        let id = try displayID(from: params)
        let includeCursor = bool(params, "includeCursor", default: true)
        let image: CGImage
        if #available(macOS 14.0, *) {
            image = try await screenCaptureKitImage(displayID: id, includeCursor: includeCursor)
        } else {
            image = try legacyDisplayImage(displayID: id)
        }
        let data = try pngData(image)
        let ids = try activeDisplayIDs()
        let index = ids.firstIndex(of: id) ?? 0
        return [
            "data": data.base64EncodedString(),
            "mimeType": "image/png",
            "capturedAt": ISO8601DateFormatter().string(from: Date()),
            "display": displayDictionary(id, index: index),
            "pixelWidth": image.width,
            "pixelHeight": image.height,
        ]
    }

    private func validate(_ point: CGPoint) throws {
        let valid = try activeDisplayIDs().contains { CGDisplayBounds($0).contains(point) }
        if !valid {
            throw HelperFailure(
                "INVALID_COORDINATES",
                "Coordinates (\(point.x), \(point.y)) are outside all connected displays. Refresh with computer_get_screen_info."
            )
        }
    }

    // MARK: - Windows

    private func screenIndex(for bounds: CGRect, displays: [CGDirectDisplayID]) -> Int? {
        var bestIndex: Int?
        var bestArea: CGFloat = 0
        for (index, displayID) in displays.enumerated() {
            let intersection = bounds.intersection(CGDisplayBounds(displayID))
            let area = max(0, intersection.width) * max(0, intersection.height)
            if area > bestArea {
                bestArea = area
                bestIndex = index
            }
        }
        return bestIndex
    }

    private func windowDictionary(_ info: [String: Any], displays: [CGDirectDisplayID], frontmostPID: pid_t?) -> [String: Any]? {
        let layer = (info[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
        guard layer == 0 else { return nil }
        guard let boundsRaw = info[kCGWindowBounds as String] as? CFDictionary,
              let bounds = CGRect(dictionaryRepresentation: boundsRaw),
              bounds.width > 0, bounds.height > 0 else { return nil }
        let processID = pid_t((info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? 0)
        guard processID > 0 else { return nil }
        let application = NSRunningApplication(processIdentifier: processID)
        let applicationName = (info[kCGWindowOwnerName as String] as? String)
            ?? application?.localizedName
            ?? ""
        let onScreen = (info[kCGWindowIsOnscreen as String] as? Bool) ?? false
        let isFrontmost = frontmostPID == processID
        let screen = screenIndex(for: bounds, displays: displays)
        return [
            "applicationName": applicationName,
            "bundleIdentifier": jsonValue(application?.bundleIdentifier),
            "processId": Int(processID),
            "windowId": jsonValue((info[kCGWindowNumber as String] as? NSNumber)?.intValue),
            "title": (info[kCGWindowName as String] as? String) ?? "",
            "x": Double(bounds.origin.x),
            "y": Double(bounds.origin.y),
            "width": Double(bounds.width),
            "height": Double(bounds.height),
            "active": isFrontmost && onScreen,
            "frontmost": isFrontmost,
            "minimized": !onScreen,
            "onScreen": onScreen,
            "screenIndex": jsonValue(screen),
        ]
    }

    private func windows(onScreenOnly: Bool, limit: Int) throws -> [[String: Any]] {
        let options: CGWindowListOption = onScreenOnly
            ? [.optionOnScreenOnly, .excludeDesktopElements]
            : [.optionAll, .excludeDesktopElements]
        guard let raw = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
            throw HelperFailure("NATIVE_OPERATION_FAILED", "Quartz Window Services did not return a window list.")
        }
        let displays = try activeDisplayIDs()
        let frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
        var result: [[String: Any]] = []
        for info in raw {
            if let window = windowDictionary(info, displays: displays, frontmostPID: frontmostPID) {
                result.append(window)
                if result.count >= max(1, limit) { break }
            }
        }
        return result
    }

    private func activeWindow() throws -> [String: Any]? {
        guard let frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier else { return nil }
        let displays = try activeDisplayIDs()
        guard let raw = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            return nil
        }
        for info in raw {
            let pid = pid_t((info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? 0)
            if pid == frontmostPID,
               let window = windowDictionary(info, displays: displays, frontmostPID: frontmostPID) {
                return window
            }
        }
        return nil
    }

    // MARK: - Mouse

    private func currentMousePosition() -> CGPoint {
        if let location = CGEvent(source: nil)?.location { return location }
        let appKitPoint = NSEvent.mouseLocation
        let mainHeight = screenForDisplay(CGMainDisplayID())?.frame.height ?? CGDisplayBounds(CGMainDisplayID()).height
        return CGPoint(x: appKitPoint.x, y: mainHeight - appKitPoint.y)
    }

    private func mouseButton(_ value: String) throws -> CGMouseButton {
        switch value.lowercased() {
        case "left": return .left
        case "right": return .right
        case "middle": return .center
        default: throw HelperFailure("NATIVE_OPERATION_FAILED", "Unsupported mouse button: \(value)")
        }
    }

    private func mouseEventType(button: CGMouseButton, down: Bool) -> CGEventType {
        switch (button, down) {
        case (.left, true): return .leftMouseDown
        case (.left, false): return .leftMouseUp
        case (.right, true): return .rightMouseDown
        case (.right, false): return .rightMouseUp
        case (_, true): return .otherMouseDown
        case (_, false): return .otherMouseUp
        }
    }

    private func draggedEventType(button: CGMouseButton) -> CGEventType {
        switch button {
        case .left: return .leftMouseDragged
        case .right: return .rightMouseDragged
        default: return .otherMouseDragged
        }
    }

    private func postMouse(type: CGEventType, point: CGPoint, button: CGMouseButton, clickState: Int64? = nil) throws {
        guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button) else {
            throw HelperFailure("NATIVE_OPERATION_FAILED", "Could not create a Quartz mouse event.")
        }
        if let clickState { event.setIntegerValueField(.mouseEventClickState, value: clickState) }
        event.post(tap: .cghidEventTap)
    }

    private func click(point: CGPoint, button: CGMouseButton, count: Int) throws {
        let normalizedCount = count == 2 ? 2 : 1
        for clickNumber in 1...normalizedCount {
            try postMouse(type: mouseEventType(button: button, down: true), point: point, button: button, clickState: Int64(clickNumber))
            try postMouse(type: mouseEventType(button: button, down: false), point: point, button: button, clickState: Int64(clickNumber))
            if normalizedCount == 2 && clickNumber == 1 { Thread.sleep(forTimeInterval: 0.08) }
        }
    }

    private func drag(_ params: [String: Any]) throws {
        let from = try nestedPoint(params, "from")
        let to = try nestedPoint(params, "to")
        try validate(from)
        try validate(to)
        let button = try mouseButton(string(params, "button"))
        let durationMs = max(0, min(10_000, integer(params, "durationMs", default: 500)))
        try postMouse(type: mouseEventType(button: button, down: true), point: from, button: button)
        let steps = max(1, durationMs / 16)
        for step in 1...steps {
            let progress = CGFloat(step) / CGFloat(steps)
            let point = CGPoint(
                x: from.x + (to.x - from.x) * progress,
                y: from.y + (to.y - from.y) * progress
            )
            try postMouse(type: draggedEventType(button: button), point: point, button: button)
            if durationMs > 0 { Thread.sleep(forTimeInterval: Double(durationMs) / Double(steps) / 1000.0) }
        }
        try postMouse(type: mouseEventType(button: button, down: false), point: to, button: button)
    }

    private func scroll(deltaX: Int, deltaY: Int) throws {
        guard let event = CGEvent(
            scrollWheelEvent2Source: nil,
            units: .pixel,
            wheelCount: 2,
            wheel1: Int32(clamping: deltaY),
            wheel2: Int32(clamping: deltaX),
            wheel3: 0
        ) else {
            throw HelperFailure("NATIVE_OPERATION_FAILED", "Could not create a Quartz scroll event.")
        }
        event.post(tap: .cghidEventTap)
    }

    // MARK: - Keyboard

    private let keyCodes: [String: CGKeyCode] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7,
        "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15,
        "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22,
        "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
        "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "enter": 36,
        "return": 36, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42,
        ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "tab": 48, "space": 49,
        "`": 50, "backspace": 51, "escape": 53, "esc": 53, "f1": 122, "f2": 120,
        "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100,
        "f9": 101, "f10": 109, "f11": 103, "f12": 111, "home": 115,
        "pageup": 116, "page up": 116, "delete": 117, "end": 119, "pagedown": 121,
        "page down": 121, "left": 123, "leftarrow": 123, "right": 124,
        "rightarrow": 124, "down": 125, "downarrow": 125, "up": 126, "uparrow": 126,
    ]

    private func flags(_ modifiers: [String]) -> CGEventFlags {
        var result: CGEventFlags = []
        for modifier in modifiers.map({ $0.lowercased() }) {
            switch modifier {
            case "command": result.insert(.maskCommand)
            case "control": result.insert(.maskControl)
            case "option": result.insert(.maskAlternate)
            case "shift": result.insert(.maskShift)
            case "fn": result.insert(.maskSecondaryFn)
            default: break
            }
        }
        return result
    }

    private func normalizedKey(_ input: String) -> (String, Bool) {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count == 1 {
            let lower = trimmed.lowercased()
            let shifted = trimmed != lower || ["+", "_", "{", "}", ":", "\"", "|", "<", ">", "?", "~", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")"].contains(trimmed)
            let base: [String: String] = [
                "+": "=", "_": "-", "{": "[", "}": "]", ":": ";", "\"": "'", "|": "\\",
                "<": ",", ">": ".", "?": "/", "~": "`", "!": "1", "@": "2", "#": "3",
                "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
            ]
            return (base[trimmed] ?? lower, shifted)
        }
        return (trimmed.lowercased(), false)
    }

    private func pressKey(_ key: String, modifiers: [String]) throws {
        let (normalized, impliedShift) = normalizedKey(key)
        guard let keyCode = keyCodes[normalized] else {
            throw HelperFailure("NATIVE_OPERATION_FAILED", "Unsupported key: \(key)")
        }
        var effectiveModifiers = modifiers
        if impliedShift && !effectiveModifiers.map({ $0.lowercased() }).contains("shift") {
            effectiveModifiers.append("shift")
        }
        let eventFlags = flags(effectiveModifiers)
        let source = CGEventSource(stateID: .hidSystemState)
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) else {
            throw HelperFailure("NATIVE_OPERATION_FAILED", "Could not create a Quartz keyboard event.")
        }
        down.flags = eventFlags
        up.flags = eventFlags
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    private func hotkey(_ keys: [String]) throws {
        let modifiers = keys.filter { modifierNames.contains($0.lowercased()) }
        let ordinaryKeys = keys.filter { !modifierNames.contains($0.lowercased()) }
        guard ordinaryKeys.count == 1 else {
            throw HelperFailure("NATIVE_OPERATION_FAILED", "A hotkey must contain exactly one non-modifier key.")
        }
        try pressKey(ordinaryKeys[0], modifiers: modifiers)
    }

    private func unicodeChunks(_ text: String, maximumUTF16Units: Int = 20) -> [[UInt16]] {
        let units = Array(text.utf16)
        var chunks: [[UInt16]] = []
        var index = 0
        while index < units.count {
            var end = min(units.count, index + maximumUTF16Units)
            if end < units.count && end > index {
                let last = units[end - 1]
                if last >= 0xD800 && last <= 0xDBFF { end -= 1 }
            }
            if end == index { end = min(units.count, index + 2) }
            chunks.append(Array(units[index..<end]))
            index = end
        }
        return chunks
    }

    private func typeText(_ text: String, intervalMs: Int) throws {
        let source = CGEventSource(stateID: .hidSystemState)
        for chunk in unicodeChunks(text) {
            guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else {
                throw HelperFailure("NATIVE_OPERATION_FAILED", "Could not create a Unicode keyboard event.")
            }
            chunk.withUnsafeBufferPointer { buffer in
                down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress)
                up.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress)
            }
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
            if intervalMs > 0 { Thread.sleep(forTimeInterval: Double(intervalMs) / 1000.0) }
        }
    }

    // MARK: - Accessibility

    private func axValue(_ element: AXUIElement, _ attribute: CFString) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, attribute, &value) == .success ? value : nil
    }

    private func axString(_ element: AXUIElement, _ attribute: CFString) -> String? {
        return axValue(element, attribute) as? String
    }

    private func axBool(_ element: AXUIElement, _ attribute: CFString) -> Bool? {
        return axValue(element, attribute) as? Bool
    }

    private func axPoint(_ element: AXUIElement, _ attribute: CFString) -> CGPoint? {
        guard let raw = axValue(element, attribute), CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
        var value = CGPoint.zero
        return AXValueGetValue(raw as! AXValue, .cgPoint, &value) ? value : nil
    }

    private func axSize(_ element: AXUIElement, _ attribute: CFString) -> CGSize? {
        guard let raw = axValue(element, attribute), CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
        var value = CGSize.zero
        return AXValueGetValue(raw as! AXValue, .cgSize, &value) ? value : nil
    }

    private func safeAccessibilityValue(_ element: AXUIElement, role: String?) -> Any {
        if role == "AXSecureTextField" { return "[REDACTED]" }
        guard let raw = axValue(element, kAXValueAttribute as CFString) else { return NSNull() }
        if let text = raw as? String { return String(text.prefix(2_000)) }
        if let number = raw as? NSNumber { return number }
        return NSNull()
    }

    private func accessibilityNode(
        _ element: AXUIElement,
        depth: Int,
        maxDepth: Int,
        maxNodes: Int,
        count: inout Int
    ) -> [String: Any] {
        if count >= maxNodes { return ["truncated": true] }
        count += 1
        let role = axString(element, kAXRoleAttribute as CFString)
        var result: [String: Any] = [
            "role": jsonValue(role),
            "title": jsonValue(axString(element, kAXTitleAttribute as CFString)),
            "value": safeAccessibilityValue(element, role: role),
            "description": jsonValue(axString(element, kAXDescriptionAttribute as CFString)),
            "position": jsonValue(axPoint(element, kAXPositionAttribute as CFString).map(pointDictionary)),
            "size": jsonValue(axSize(element, kAXSizeAttribute as CFString).map(sizeDictionary)),
            "enabled": jsonValue(axBool(element, kAXEnabledAttribute as CFString)),
            "focused": jsonValue(axBool(element, kAXFocusedAttribute as CFString)),
        ]
        if depth < maxDepth, let children = axValue(element, kAXChildrenAttribute as CFString) as? [AXUIElement] {
            var childNodes: [[String: Any]] = []
            for child in children {
                if count >= maxNodes {
                    childNodes.append(["truncated": true])
                    break
                }
                childNodes.append(accessibilityNode(
                    child,
                    depth: depth + 1,
                    maxDepth: maxDepth,
                    maxNodes: maxNodes,
                    count: &count
                ))
            }
            result["children"] = childNodes
        }
        return result
    }

    private func accessibilityTree(maxDepth: Int, maxNodes: Int) throws -> [String: Any] {
        guard let processID = NSWorkspace.shared.frontmostApplication?.processIdentifier else {
            throw HelperFailure("NATIVE_OPERATION_FAILED", "No frontmost application is available.")
        }
        let application = AXUIElementCreateApplication(processID)
        var count = 0
        return accessibilityNode(application, depth: 0, maxDepth: maxDepth, maxNodes: maxNodes, count: &count)
    }

    private func focusedElement() throws -> [String: Any]? {
        let system = AXUIElementCreateSystemWide()
        guard let raw = axValue(system, kAXFocusedUIElementAttribute as CFString) else { return nil }
        let element = raw as! AXUIElement
        var count = 0
        return accessibilityNode(element, depth: 0, maxDepth: 0, maxNodes: 1, count: &count)
    }

    // MARK: - JSON helpers

    private func pointDictionary(_ point: CGPoint) -> [String: Any] {
        return ["x": Double(point.x), "y": Double(point.y)]
    }

    private func jsonValue(_ value: Any?) -> Any {
        return value ?? NSNull()
    }

    private func sizeDictionary(_ size: CGSize) -> [String: Any] {
        return ["width": Double(size.width), "height": Double(size.height)]
    }

    private func rectDictionary(_ rect: CGRect) -> [String: Any] {
        return [
            "x": Double(rect.origin.x),
            "y": Double(rect.origin.y),
            "width": Double(rect.width),
            "height": Double(rect.height),
        ]
    }
}

@main
struct ComputerUseHelperMain {
    static func main() async {
        let helper = ComputerUseHelper()
        while let line = readLine(strippingNewline: true) {
            guard let data = line.data(using: .utf8) else { continue }
            var id = "unknown"
            do {
                guard let request = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    throw HelperFailure("NATIVE_OPERATION_FAILED", "Request must be a JSON object.")
                }
                id = request["id"] as? String ?? "unknown"
                guard let action = request["action"] as? String else {
                    throw HelperFailure("NATIVE_OPERATION_FAILED", "Request is missing an action.")
                }
                let params = request["params"] as? [String: Any] ?? [:]
                let result = try await helper.handle(action: action, params: params)
                writeResponse(["id": id, "ok": true, "result": result])
            } catch let failure as HelperFailure {
                var error: [String: Any] = ["code": failure.code, "message": failure.message]
                if let details = failure.details { error["details"] = details }
                writeResponse(["id": id, "ok": false, "error": error])
            } catch {
                writeResponse([
                    "id": id,
                    "ok": false,
                    "error": ["code": "NATIVE_OPERATION_FAILED", "message": error.localizedDescription],
                ])
            }
        }
    }

    private static func writeResponse(_ response: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: response),
              var line = String(data: data, encoding: .utf8) else { return }
        line.append("\n")
        FileHandle.standardOutput.write(line.data(using: .utf8)!)
    }
}
