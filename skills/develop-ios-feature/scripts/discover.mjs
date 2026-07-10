#!/usr/bin/env node
/**
 * discover.mjs
 * Emit a structured Phase 0 project overview for an iOS codebase: layout
 * (Xcode app vs Swift package vs hybrid), schemes and targets, build-setting
 * heuristics from project.pbxproj, test layout (unit / XCUITest / snapshot),
 * lint config, toolchain and simulator/device availability, git hooks,
 * enforcement config, and which doc files are present. Run from the project
 * root. Analytical work (feature pattern, state-management idiom, preview
 * conventions) is still done by the agent reading source files.
 */
import { readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const CACHE_DIR = '.cache/develop-ios-feature';

function readText(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function run(cmd, args, timeout = 60000) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  return res.status === 0 ? (res.stdout ?? '').trim() : null;
}

// --- Layout: workspace / project / package ---
// A .xcodeproj bundle always contains project.xcworkspace; only a standalone
// workspace counts as "the workspace layout".
const rootEntries = (() => { try { return readdirSync('.'); } catch { return []; } })();
const workspaces = rootEntries.filter((e) => e.endsWith('.xcworkspace'));
const projects = rootEntries.filter((e) => e.endsWith('.xcodeproj'));
const hasPackage = existsSync('Package.swift');
const container = workspaces.length
  ? { flag: '-workspace', path: workspaces[0] }
  : projects.length
    ? { flag: '-project', path: projects[0] }
    : null;
const layout = container && hasPackage
  ? 'hybrid (Xcode app + Package.swift)'
  : container
    ? 'Xcode app'
    : hasPackage
      ? 'Swift package'
      : 'unknown (no .xcworkspace, .xcodeproj, or Package.swift at the root)';

// --- Schemes & targets (app layouts) ---
let schemes = [];
let targets = [];
if (container) {
  const listOut = run('xcodebuild', ['-list', '-json', container.flag, container.path]);
  if (listOut) {
    // xcodebuild sometimes prefixes warnings before the JSON; slice to the brace.
    const jsonStart = listOut.indexOf('{');
    try {
      const parsed = JSON.parse(listOut.slice(jsonStart));
      const info = parsed.workspace ?? parsed.project ?? {};
      schemes = info.schemes ?? [];
      targets = info.targets ?? [];
    } catch { /* unparseable — report empty */ }
  }
}

// --- project.pbxproj heuristics ---
const pbxprojPath = projects.length ? join(projects[0], 'project.pbxproj') : null;
const pbxproj = pbxprojPath ? readText(pbxprojPath) : '';
const pbxValue = (key) => {
  const values = [...new Set([...pbxproj.matchAll(new RegExp(`${key}\\s*=\\s*"?([^";]+)"?;`, 'g'))].map((m) => m[1].trim()))];
  return values.length ? values.join(', ') : null;
};
const deploymentTarget = pbxValue('IPHONEOS_DEPLOYMENT_TARGET');
const marketingVersion = pbxValue('MARKETING_VERSION');
const swiftVersion = pbxValue('SWIFT_VERSION');
const bundleIds = pbxValue('PRODUCT_BUNDLE_IDENTIFIER');
const deviceFamily = pbxValue('TARGETED_DEVICE_FAMILY'); // 1 = iPhone, 2 = iPad
// Xcode 16 filesystem-synchronized groups: new files on disk join the target
// automatically. Without them, every new file needs a project.pbxproj edit or
// it silently never compiles.
const syncedGroups = pbxproj.includes('PBXFileSystemSynchronizedRootGroup');

// --- Swift package manifest (package / hybrid layouts) ---
let packageInfo = null;
if (hasPackage) {
  const dump = run('swift', ['package', 'dump-package'], 120000);
  if (dump) {
    try {
      const pkg = JSON.parse(dump);
      packageInfo = {
        name: pkg.name,
        platforms: (pkg.platforms ?? []).map((p) => `${p.platformName} ${p.version}`),
        targets: (pkg.targets ?? []).map((t) => `${t.name} (${t.type})`),
        deps: (pkg.dependencies ?? []).map((d) => d.sourceControl?.[0]?.location?.remote?.[0]?.urlString ?? d.fileSystem?.[0]?.path ?? 'unknown'),
      };
    } catch { /* unparseable */ }
  }
}

// --- Tests ---
// git ls-files keeps this fast and vendor-free; fall back to "unknown" outside git.
let testFiles = [];
let uiTestFiles = [];
try {
  testFiles = execFileSync('git', ['ls-files', '*Tests*.swift', '*Test*.swift'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
    .split('\n').filter(Boolean);
  uiTestFiles = testFiles.filter((f) => /XCUIApplication/.test(readText(f)));
} catch { /* not a git repo */ }
const resolvedPaths = ['Package.resolved', ...projects.map((p) => join(p, 'project.xcworkspace/xcshareddata/swiftpm/Package.resolved')),
  ...(workspaces.length ? [join(workspaces[0], 'xcshareddata/swiftpm/Package.resolved')] : [])];
const resolvedBody = resolvedPaths.map(readText).join('\n');
const hasSnapshotTesting = /swift-snapshot-testing/.test(resolvedBody) || /swift-snapshot-testing/.test(readText('Package.swift'));

// --- Design language: Liquid Glass adoption mode ---
// HIG is the baseline; Liquid Glass is the system look on iOS 26+. The mode
// derives from three facts: the minimum deployment target, the SDK the
// toolchain builds with, and the UIDesignRequiresCompatibility opt-out.
const sdkVersion = run('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'], 30000);
const sdkMajor = sdkVersion ? Number(sdkVersion.split('.')[0]) : null;

// Minimum deployment target across pbxproj values and package platforms.
const targetVersions = [
  ...(deploymentTarget ? deploymentTarget.split(',').map((v) => Number(v.trim().split('.')[0])) : []),
  ...((packageInfo?.platforms ?? [])
    .filter((p) => /^ios\b/i.test(p))
    .map((p) => Number(p.match(/(\d+)/)?.[1]))),
].filter(Number.isFinite);
const minTargetMajor = targetVersions.length ? Math.min(...targetVersions) : null;

// Opt-out: the key in a tracked Info.plist, or its INFOPLIST_KEY_ build
// setting in the pbxproj.
let optedOut = /INFOPLIST_KEY_UIDesignRequiresCompatibility\s*=\s*YES/.test(pbxproj);
if (!optedOut) {
  try {
    const plists = execFileSync('git', ['ls-files', '*Info.plist'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
      .split('\n').filter(Boolean);
    optedOut = plists.some((p) => {
      const body = readText(p);
      return body.includes('UIDesignRequiresCompatibility') && /UIDesignRequiresCompatibility<\/key>\s*<true\s*\/>/.test(body);
    });
  } catch { /* not a git repo */ }
}

const glassMode = optedOut
  ? 'opted out — UIDesignRequiresCompatibility is set; follow the project\'s existing conventions, do not introduce glass'
  : (sdkMajor === null || sdkMajor < 26)
    ? 'unavailable — the toolchain SDK predates iOS 26; follow the project\'s existing conventions, no glass APIs'
    : (minTargetMajor !== null && minTargetMajor >= 26)
      ? 'native — deployment target is iOS 26+; use Liquid Glass APIs directly, no availability gates'
      : (minTargetMajor !== null)
        ? 'gated + fallback — deployment target < iOS 26 on an iOS 26+ SDK; adopt Liquid Glass behind `if #available(iOS 26.0, *)` with an .ultraThinMaterial fallback'
        : 'undetermined — no deployment target found; confirm before choosing glass APIs';

// --- Lint / format config ---
const swiftlintConfig = ['.swiftlint.yml', '.swiftlint.yaml'].find((p) => existsSync(p));
const swiftformatConfig = existsSync('.swiftformat') ? '.swiftformat' : null;
const hasXcbeautify = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['xcbeautify'], { encoding: 'utf8' }).status === 0;

// --- Toolchain, simulators, physical devices ---
const xcodePath = run('xcode-select', ['-p'], 10000);
const xcodeVersion = run('xcodebuild', ['-version'], 30000)?.replace(/\n/g, ' — ');
let runtimes = [];
let simDevices = [];
const simList = run('xcrun', ['simctl', 'list', '-j'], 30000);
if (simList) {
  try {
    const parsed = JSON.parse(simList);
    runtimes = (parsed.runtimes ?? []).filter((r) => r.isAvailable && /iOS/.test(r.name)).map((r) => r.name);
    for (const [runtimeId, devices] of Object.entries(parsed.devices ?? {})) {
      if (!/iOS/.test(runtimeId)) continue;
      for (const d of devices) {
        if (d.isAvailable) simDevices.push(`${d.name} (${d.state})`);
      }
    }
  } catch { /* unparseable */ }
}
// devicectl only emits machine-readable output to a file.
let physicalDevices = [];
const devicectlJson = join(CACHE_DIR, 'devicectl-list.json');
try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignore */ }
if (run('xcrun', ['devicectl', 'list', 'devices', '--json-output', devicectlJson], 30000) !== null) {
  const parsed = readJSON(devicectlJson);
  physicalDevices = (parsed?.result?.devices ?? []).map((d) => {
    const name = d.deviceProperties?.name ?? 'unknown';
    const udid = d.hardwareProperties?.udid ?? 'unknown';
    const state = d.connectionProperties?.tunnelState ?? d.deviceProperties?.bootState ?? '?';
    return `${name} — ${udid} (${state})`;
  });
}

// --- Git hooks ---
const hooks = [];
for (const dir of ['.githooks', '.git/hooks']) {
  if (existsSync(dir)) {
    try {
      readdirSync(dir).filter((f) => !f.endsWith('.sample')).forEach((f) => hooks.push(`${dir}/${f}`));
    } catch { /* ignore */ }
  }
}

// --- .claude/settings.json enforcement ---
const settings = readJSON('.claude/settings.json');
const preHooks = (settings?.hooks?.PreToolUse ?? [])
  .flatMap((h) => (h.hooks ?? []).map((hk) => hk.command));
const allowList = settings?.permissions?.allow ?? [];

// --- Inferred default gates (what gates.mjs will run without an override) ---
const inferredGates = container
  ? [
      `\`xcodebuild build\` (${container.flag} ${container.path}, simulator destination, CODE_SIGNING_ALLOWED=NO)`,
      '`xcodebuild test` (same destination)',
      ...(swiftlintConfig ? ['`swiftlint lint`'] : []),
      ...(swiftformatConfig ? ['`swiftformat --lint .`'] : []),
    ]
  : hasPackage
    ? ['`swift build`', '`swift test`',
       ...(swiftlintConfig ? ['`swiftlint lint`'] : []),
       ...(swiftformatConfig ? ['`swiftformat --lint .`'] : [])]
    : ['none inferable — pin commands in .cache/develop-ios-feature/gates.json'];

// --- Docs ---
const DOCS = ['CLAUDE.md', 'AGENTS.md', 'README.md', 'CONTRIBUTING.md', 'DESIGN.md'];

// --- Output ---
const lines = [
  '## Project Discovery',
  '',
  `**Layout:** ${layout}`,
  ...(container ? [`**Container:** \`${container.flag} ${container.path}\``] : []),
  ...(schemes.length ? [`**Schemes:** ${schemes.join(', ')}`] : container ? ['**Schemes:** none found (xcodebuild -list failed or empty)'] : []),
  ...(targets.length ? [`**Targets:** ${targets.join(', ')}`] : []),
  ...(pbxproj
    ? [
        `**Deployment target (iOS):** ${deploymentTarget ?? 'not set in pbxproj'}`,
        `**Marketing version:** ${marketingVersion ?? 'not set in pbxproj'}`,
        `**Swift version:** ${swiftVersion ?? 'not set in pbxproj'}`,
        `**Bundle identifier(s):** ${bundleIds ?? 'not set in pbxproj'}`,
        `**Device family:** ${deviceFamily ?? 'not set'} (1 = iPhone, 2 = iPad)`,
        `**Filesystem-synchronized groups:** ${
          syncedGroups
            ? 'yes — new files on disk join their target automatically'
            : 'NO — every new file must be registered in project.pbxproj or it silently never compiles'
        }`,
      ]
    : []),
  ...(packageInfo
    ? [
        '',
        '### Swift package',
        `- name: ${packageInfo.name}`,
        `- platforms: ${packageInfo.platforms.length ? packageInfo.platforms.join(', ') : 'unspecified'}`,
        `- targets: ${packageInfo.targets.join(', ')}`,
        ...(packageInfo.deps.length ? [`- dependencies: ${packageInfo.deps.join(', ')}`] : []),
      ]
    : []),
  '',
  '### Inferred Gates (gates.mjs defaults)',
  ...inferredGates.map((g) => `- ${g}`),
  '',
  '### Tests',
  `- test files: ${testFiles.length || 'unknown (not a git repo?)'}`,
  `- XCUITest (UI tests): ${uiTestFiles.length ? `yes (${uiTestFiles.length} file(s))` : 'not detected'}`,
  `- swift-snapshot-testing: ${hasSnapshotTesting ? 'yes' : 'not detected'}`,
  '',
  '### Design language (HIG + Liquid Glass)',
  `- iOS SDK: ${sdkVersion ?? 'unknown'}`,
  `- minimum deployment target: ${minTargetMajor !== null ? `iOS ${minTargetMajor}` : 'unknown'}`,
  `- Liquid Glass adoption mode: ${glassMode}`,
  ...(glassMode.startsWith('gated')
    ? [`- older-runtime simulator for fallback-parity screenshots: ${
        (runtimes ?? []).some((r) => {
          const major = Number(r.match(/iOS (\d+)/)?.[1]);
          return Number.isFinite(major) && major < 26;
        })
          ? 'available'
          : 'none installed — score the fallback from its pinned preview'
      }`]
    : []),
  '',
  '### Lint / format',
  swiftlintConfig ? `- SwiftLint config: \`${swiftlintConfig}\`` : '- no SwiftLint config; lint gate skipped unless pinned via gates.json',
  swiftformatConfig ? `- SwiftFormat config: \`${swiftformatConfig}\`` : '- no SwiftFormat config',
  `- xcbeautify on PATH: ${hasXcbeautify ? 'yes (gate logs are prettified)' : 'no (raw xcodebuild logs)'}`,
  '',
  '### Toolchain',
  `- xcode-select -p: ${xcodePath ?? 'FAILED — is Xcode installed and selected?'}`,
  `- xcodebuild: ${xcodeVersion ?? 'unavailable'}`,
  `- iOS simulator runtimes: ${runtimes.length ? runtimes.join(', ') : 'none available'}`,
  `- simulator devices: ${simDevices.length ? simDevices.slice(0, 12).join('; ') : 'none available'}`,
  `- connected physical devices: ${physicalDevices.length ? physicalDevices.join('; ') : 'none detected'}`,
  '',
  '### Git Hooks',
  ...(hooks.length ? hooks.map((h) => `- \`${h}\``) : ['- none found']),
  '',
  '### Enforcement (.claude/settings.json)',
  ...(preHooks.length
    ? ['PreToolUse hooks:', ...preHooks.map((h) => `  - \`${h}\``)]
    : ['- no PreToolUse hooks configured']),
  ...(allowList.length
    ? ['Allow list:', ...allowList.map((e) => `  - \`${e}\``)]
    : []),
  '',
  '### Docs',
  ...DOCS.map((d) => `- ${d}: ${existsSync(d) ? '✓' : '✗'}`),
];

console.log(lines.join('\n'));
