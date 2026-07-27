/**
 * Browser Compatibility Detection Module
 *
 * Checks for required browser APIs:
 * - navigator.mediaDevices.getUserMedia (camera access)
 * - WebGL (required by MediaPipe)
 * - Web Speech API (speechSynthesis for spoken instructions)
 *
 * @module BrowserCompatibility
 */

export interface CompatibilityResult {
  compatible: boolean;
  missingFeatures: string[];
}

/**
 * Checks whether the current browser supports all APIs required by the application.
 *
 * Returns a result indicating overall compatibility and a list of any missing features.
 */
export function checkCompatibility(): CompatibilityResult {
  const missingFeatures: string[] = [];

  // Check getUserMedia support
  if (
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    missingFeatures.push('Camera Access (getUserMedia)');
  }

  // Check WebGL support
  if (!checkWebGLSupport()) {
    missingFeatures.push('WebGL (required for MediaPipe)');
  }

  // Check Web Speech API support
  if (typeof window.speechSynthesis === 'undefined') {
    missingFeatures.push('Web Speech API (speechSynthesis)');
  }

  return {
    compatible: missingFeatures.length === 0,
    missingFeatures,
  };
}

/**
 * Checks whether the browser supports WebGL by attempting to create a WebGL context
 * on an offscreen canvas element.
 */
function checkWebGLSupport(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return gl !== null;
  } catch {
    return false;
  }
}

/**
 * List of browsers known to support all required APIs.
 */
export const SUPPORTED_BROWSERS = [
  'Google Chrome (desktop & Android)',
  'Microsoft Edge',
  'Mozilla Firefox',
  'Safari (macOS & iOS)',
] as const;
