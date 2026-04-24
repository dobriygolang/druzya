// swift-tools-version:5.9
import PackageDescription

// CursorHelper — a tiny standalone binary that freezes and thaws the
// macOS system cursor on command. Runs as a long-lived child of the
// Electron main process. See docs/copilot-virtual-cursor.md.

let package = Package(
    name: "CursorHelper",
    platforms: [
        .macOS(.v13),
    ],
    targets: [
        .executableTarget(
            name: "CursorHelper",
            path: "Sources/CursorHelper"
        ),
    ]
)
