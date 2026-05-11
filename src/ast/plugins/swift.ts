/**
 * Swift Language Plugin
 *
 * Extracts dependencies and exports from Swift source.
 * Handles: .swift
 */

import type { LanguagePlugin } from '../types.js';

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

const SWIFT_EXTERNAL_MODULES = new Set([
  // Apple system frameworks
  'Foundation', 'UIKit', 'AppKit', 'SwiftUI', 'Combine', 'CoreData',
  'CoreGraphics', 'CoreImage', 'CoreLocation', 'CoreML', 'CoreMotion',
  'CoreText', 'CoreVideo', 'CoreFoundation', 'CoreAudio', 'CoreServices',
  'AVFoundation', 'AVKit', 'MapKit', 'WebKit', 'StoreKit', 'HealthKit',
  'HomeKit', 'GameKit', 'GameplayKit', 'SceneKit', 'SpriteKit', 'ARKit',
  'RealityKit', 'Metal', 'MetalKit', 'MetalPerformanceShaders',
  'Photos', 'PhotosUI', 'Vision', 'NaturalLanguage', 'Speech',
  'Accelerate', 'Network', 'CryptoKit', 'CommonCrypto', 'Security',
  'CloudKit', 'EventKit', 'Contacts', 'MessageUI', 'UserNotifications',
  'Intents', 'IntentsUI', 'WidgetKit', 'ActivityKit', 'BackgroundTasks',
  'OSLog', 'os', 'Dispatch', 'Darwin', 'Swift', 'XCTest',
  // Common third-party
  'Alamofire', 'RxSwift', 'RxCocoa', 'SnapKit', 'Kingfisher', 'SDWebImage',
  'Moya', 'SwiftyJSON', 'ObjectMapper', 'Realm', 'RealmSwift', 'GRDB',
  'Quick', 'Nimble', 'Lottie', 'Charts', 'Firebase', 'FirebaseCore',
  'FirebaseAuth', 'FirebaseFirestore', 'FirebaseDatabase', 'FirebaseStorage',
  'FirebaseAnalytics', 'FirebaseMessaging', 'FirebaseCrashlytics',
  'GoogleSignIn', 'FBSDKCoreKit', 'FBSDKLoginKit', 'Stripe',
  'PromiseKit', 'ReactiveSwift', 'ReactiveCocoa',
  'ComposableArchitecture', 'TCA',
]);

function isExternalSwiftModule(name: string): boolean {
  const root = name.split('.')[0];
  return SWIFT_EXTERNAL_MODULES.has(root ?? name);
}

function extractSwiftDeps(source: string): string[] {
  const deps: string[] = [];

  // import [kind] Module[.Submodule]
  // kind ∈ { typealias, struct, class, enum, protocol, let, var, func } (rare submodule imports)
  const importPat = /^[ \t]*import\s+(?:(?:typealias|struct|class|enum|protocol|let|var|func)\s+)?([\w.]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = importPat.exec(source)) !== null) {
    const name = m[1];
    if (isExternalSwiftModule(name)) continue;
    const parts = name.split('.');
    deps.push(parts[0] ?? name);
  }

  return dedupe(deps);
}

function extractSwiftExports(source: string): string[] {
  const exports: string[] = [];

  // Top-level types: struct / class / protocol / enum / actor
  const typePat =
    /^[ \t]*(?:(?:public|internal|private|fileprivate|open|final|@objc|@objcMembers|@MainActor|@available\([^)]*\))\s+)*(struct|class|protocol|enum|actor)\s+(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = typePat.exec(source)) !== null) {
    const lineStart = source.lastIndexOf('\n', m.index) + 1;
    const indent = m.index - lineStart;
    if (indent === 0) exports.push(m[2]);
  }

  // Public functions (top-level or any visibility-marked public func)
  const funcPat =
    /^[ \t]*(?:(?:@\w+(?:\([^)]*\))?\s+)*)?public\s+(?:(?:final|static|class|override|mutating|nonisolated|@MainActor)\s+)*func\s+(\w+)\s*(\([^)]*\))/gm;
  while ((m = funcPat.exec(source)) !== null) {
    exports.push(`${m[1]}${m[2]}`);
  }

  return dedupe(exports);
}

function extractSwiftFunctionCode(source: string, functionName: string): string | null {
  const esc = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pat = new RegExp(
    `^([ \\t]*)(?:(?:public|internal|private|fileprivate|open|final|static|class|override|mutating|nonisolated)\\s+)*func\\s+${esc}\\s*\\(`,
    'm',
  );
  const m = pat.exec(source);
  if (!m) return null;

  const slice = source.slice(m.index);
  const braceIdx = slice.indexOf('{');
  if (braceIdx === -1) return null;

  let depth = 0;
  let end = -1;
  for (let i = braceIdx; i < slice.length; i++) {
    if (slice[i] === '{') depth++;
    else if (slice[i] === '}') {
      if (--depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return null;
  return slice.slice(0, end + 1).trim();
}

function extractSwiftModulePurpose(source: string): string | null {
  // Doc comment /// at file head
  const docLineMatch = /^((?:[ \t]*\/\/\/[^\n]*\n)+)/.exec(source);
  if (docLineMatch) {
    const lines = docLineMatch[1]
      .split('\n')
      .map((l) => l.replace(/^[ \t]*\/\/\/\s?/, '').trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) return lines[0];
  }

  // Block doc /** ... */
  const docBlockMatch = /^\/\*\*([\s\S]*?)\*\//m.exec(source);
  if (docBlockMatch && source.trimStart().startsWith('/**')) {
    const lines = docBlockMatch[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter((l) => l.length > 0 && !l.startsWith('@'));
    if (lines.length > 0) return lines[0];
  }

  // Plain // comment block
  const lineMatch = /^((?:[ \t]*\/\/[^\n]*\n)+)/.exec(source);
  if (lineMatch) {
    const lines = lineMatch[1]
      .split('\n')
      .map((l) => l.replace(/^[ \t]*\/\/\s?/, '').trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) return lines[0];
  }

  return null;
}

const SWIFT_ENTRY_STEMS = new Set(['main', 'app', 'application']);

function isSwiftEntryPoint(source: string, filePath: string): boolean {
  if (/@main\b/.test(source)) return true;
  if (/@UIApplicationMain\b/.test(source)) return true;
  if (/@NSApplicationMain\b/.test(source)) return true;

  const basename = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const stem = basename.replace(/\.[^/.]+$/, '').toLowerCase();
  if (SWIFT_ENTRY_STEMS.has(stem)) return true;

  return false;
}

export const swiftPlugin: LanguagePlugin = {
  extensions: ['.swift'],
  extractDeps: extractSwiftDeps,
  extractExports: extractSwiftExports,
  extractFunctionCode: extractSwiftFunctionCode,
  extractModulePurpose: extractSwiftModulePurpose,
  isEntryPoint: isSwiftEntryPoint,
};
