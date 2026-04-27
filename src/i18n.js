import { LS_KEYS } from './config.js';

export const I18N = {
  ja: {
    'settings.title': '設定',
    'settings.language': '言語',
    'settings.wakelock': '常時画面オン',
    'settings.ball': 'ボール設定',
    'settings.ballDirection': '移動方向',
    'settings.vertical': '縦',
    'settings.horizontal': '横',
    'settings.squash': 'スクワッシュ',
    'common.on': 'ON',
    'common.off': 'OFF',
    'common.save': '保存',
    'common.cancel': 'キャンセル',
    'common.back': '← 戻る',
    'common.add': '＋ 追加',
    'metro.start': '▶ START',
    'metro.stop': '⏹ STOP',
    'metro.tap': 'TAP\nTEMPO',
    'nowplaying.playing': '再生中',
    'nav.metronome': 'メトロノーム',
    'nav.setlist': 'セットリスト',
    'nav.library': 'ライブラリ',
    'page.ball': 'ボール',
    'page.volume': '音量設定',
    'page.timesig': '拍子',
    'volume.master': '全体',
    'volume.beat1': '強拍',
    'volume.quarter': '4分',
    'volume.eighth': '8分',
    'volume.sixteenth': '16分',
    'setlist.addSetlist': '＋ 新規作成',
    'setlist.namePlaceholder': 'セットリスト名 (例: ワンマンライブ)',
    'setlist.songList': '♩ 曲リスト',
    'setlist.fromLibrary': 'ライブラリから',
    'setlist.manualInput': '直接入力',
    'library.title': '♩ 曲ライブラリ',
    'library.sort': 'ソート',
    'library.sortManual': '手動',
    'library.sortName': '曲名',
    'library.sortBpm': 'BPM',
    'library.songName': '曲名',
    'capture.currentSettings': '現在のBPM・音量・拍子設定を取り込む',
    'paywall.unlimited': '✓ セットリスト・ライブラリが無制限に',
    'paywall.volumePreset': '✓ 曲ごとの音量プリセット保存',
    'paywall.timeSignature': '✓ 曲ごとの拍子記録',
    'paywall.future': '✓ 今後追加される Pro 機能すべて',
    'paywall.upgrade': 'Pro にアップグレード（$7.99）',
    'paywall.restore': '購入を復元',
    'empty.noSetlists': 'セットリストを追加してください',
    'empty.noSongs': '曲を追加してください',
    'empty.noLibrarySongs': 'ライブラリに曲がありません',
    'label.songsCount': '曲',
    'action.edit': '編集',
    'action.delete': '削除',
    'confirm.deleteSetlist': 'このセットリストを削除しますか？',
    'confirm.deleteSong': 'この曲を削除しますか？',
    'confirm.deleteLibrarySong': 'この曲をライブラリから削除しますか？',
    'untitled': '(無題)',
  },
  en: {
    'settings.title': 'Settings',
    'settings.language': 'Language',
    'settings.wakelock': 'Keep Screen On',
    'settings.ball': 'Ball Settings',
    'settings.ballDirection': 'Ball Direction',
    'settings.vertical': 'Vertical',
    'settings.horizontal': 'Horizontal',
    'settings.squash': 'Squash',
    'common.on': 'ON',
    'common.off': 'OFF',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.back': '← Back',
    'common.add': '+ Add',
    'metro.start': '▶ START',
    'metro.stop': '⏹ STOP',
    'metro.tap': 'TAP\nTEMPO',
    'nowplaying.playing': 'Now Playing',
    'nav.metronome': 'Metronome',
    'nav.setlist': 'Setlist',
    'nav.library': 'Library',
    'page.ball': 'Ball',
    'page.volume': 'Volume',
    'page.timesig': 'Time Sig',
    'volume.master': 'Master',
    'volume.beat1': 'Accent',
    'volume.quarter': 'Quarter',
    'volume.eighth': 'Eighth',
    'volume.sixteenth': 'Sixteenth',
    'setlist.addSetlist': '+ New Setlist',
    'setlist.namePlaceholder': 'Setlist name (e.g. One-Man Live)',
    'setlist.songList': '♩ Songs',
    'setlist.fromLibrary': 'From Library',
    'setlist.manualInput': 'Manual',
    'library.title': '♩ Song Library',
    'library.sort': 'Sort',
    'library.sortManual': 'Manual',
    'library.sortName': 'Name',
    'library.sortBpm': 'BPM',
    'library.songName': 'Song name',
    'capture.currentSettings': 'Capture current BPM/volume/time-signature',
    'paywall.unlimited': '✓ Unlimited setlists and library songs',
    'paywall.volumePreset': '✓ Save volume presets per song',
    'paywall.timeSignature': '✓ Save time signatures per song',
    'paywall.future': '✓ All future Pro features',
    'paywall.upgrade': 'Upgrade to Pro ($7.99)',
    'paywall.restore': 'Restore Purchase',
    'empty.noSetlists': 'Add a setlist to get started',
    'empty.noSongs': 'Add songs to get started',
    'empty.noLibrarySongs': 'No songs in your library',
    'label.songsCount': 'songs',
    'action.edit': 'Edit',
    'action.delete': 'Delete',
    'confirm.deleteSetlist': 'Delete this setlist?',
    'confirm.deleteSong': 'Delete this song?',
    'confirm.deleteLibrarySong': 'Delete this song from the library?',
    'untitled': '(Untitled)',
  },
};

export function createI18n(initialLang = 'ja') {
  let lang = I18N[initialLang] ? initialLang : 'ja';
  const listeners = new Set();
  return {
    get lang() { return lang; },
    setLang(next) {
      if (!I18N[next] || next === lang) return;
      lang = next;
      try { localStorage.setItem(LS_KEYS.lang, next); } catch {}
      listeners.forEach(fn => fn(lang));
    },
    t(key) {
      return (I18N[lang] || I18N.ja)[key] ?? key;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function readInitialLang() {
  try {
    return localStorage.getItem(LS_KEYS.lang) || 'ja';
  } catch {
    return 'ja';
  }
}
