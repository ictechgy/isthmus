import Darwin
import Foundation
import Phase0SwiftBridgeExtractor

let result = executeSwiftBridgeCommand(
    arguments: Array(CommandLine.arguments.dropFirst()),
    readSource: { path in
        try String(contentsOfFile: path, encoding: .utf8)
    }
)
FileHandle.standardOutput.write(Data(result.standardOutput.utf8))
FileHandle.standardError.write(Data(result.standardError.utf8))
exit(result.exitCode)
