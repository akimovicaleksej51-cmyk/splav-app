// Мост к нативной части (Swift-плагин SplavNative) и к плагинам Capacitor
import { Capacitor, registerPlugin } from '@capacitor/core';
export const isNative = Capacitor.isNativePlatform();
export const Native = registerPlugin('SplavNative');
