import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Configure Monaco Environment to use locally bundled Vite workers
self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') {
      return new jsonWorker();
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new cssWorker();
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker();
    }
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker();
    }
    return new editorWorker();
  },
};

// Bundle Monaco locally instead of fetching from external jsdelivr CDN
loader.config({ monaco });

// Register CodeCollab solid monochrome themes
monaco.editor.defineTheme('codecollab-dark', {
  base: 'vs-dark',
  inherit: false,
  rules: [
    { token: '', foreground: 'ededee' },
    { token: 'comment', foreground: '71717a', fontStyle: 'italic' },
    { token: 'comment.doc', foreground: '8a8a92', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'ffffff', fontStyle: 'bold' },
    { token: 'keyword.control', foreground: 'ffffff', fontStyle: 'bold' },
    { token: 'string', foreground: 'd4d4d8' },
    { token: 'string.escape', foreground: 'ffffff', fontStyle: 'bold' },
    { token: 'number', foreground: 'e4e4e7' },
    { token: 'number.float', foreground: 'e4e4e7' },
    { token: 'number.hex', foreground: 'e4e4e7' },
    { token: 'type', foreground: 'ffffff', fontStyle: 'bold' },
    { token: 'class', foreground: 'ffffff', fontStyle: 'bold' },
    { token: 'function', foreground: 'ffffff', fontStyle: 'bold' },
    { token: 'variable', foreground: 'e4e4e7' },
    { token: 'constant', foreground: 'f4f4f5' },
    { token: 'delimiter', foreground: 'a1a1aa' },
    { token: 'delimiter.bracket', foreground: 'a1a1aa' },
    { token: 'delimiter.parenthesis', foreground: 'a1a1aa' },
    { token: 'operator', foreground: 'ededee' },
    { token: 'tag', foreground: 'ffffff', fontStyle: 'bold' },
    { token: 'attribute.name', foreground: 'd4d4d8' },
    { token: 'attribute.value', foreground: 'e4e4e7' },
  ],
  colors: {
    'editor.background': '#121316',
    'editor.foreground': '#ededee',
    'editor.lineHighlightBackground': '#18191d',
    'editor.selectionBackground': '#2c2e35',
    'editorLineNumber.foreground': '#55565b',
    'editorLineNumber.activeForeground': '#ededee',
    'editorIndentGuide.background': '#25262b',
    'editorIndentGuide.activeBackground': '#3d3e44',
    'editorCursor.foreground': '#ededee',
  },
});

monaco.editor.defineTheme('codecollab-light', {
  base: 'vs',
  inherit: false,
  rules: [
    { token: '', foreground: '18181b' },
    { token: 'comment', foreground: '8e8e93', fontStyle: 'italic' },
    { token: 'comment.doc', foreground: '787880', fontStyle: 'italic' },
    { token: 'keyword', foreground: '09090b', fontStyle: 'bold' },
    { token: 'keyword.control', foreground: '09090b', fontStyle: 'bold' },
    { token: 'string', foreground: '3f3f46' },
    { token: 'string.escape', foreground: '09090b', fontStyle: 'bold' },
    { token: 'number', foreground: '27272a' },
    { token: 'number.float', foreground: '27272a' },
    { token: 'number.hex', foreground: '27272a' },
    { token: 'type', foreground: '09090b', fontStyle: 'bold' },
    { token: 'class', foreground: '09090b', fontStyle: 'bold' },
    { token: 'function', foreground: '09090b', fontStyle: 'bold' },
    { token: 'variable', foreground: '27272a' },
    { token: 'constant', foreground: '18181b' },
    { token: 'delimiter', foreground: '52525b' },
    { token: 'delimiter.bracket', foreground: '52525b' },
    { token: 'delimiter.parenthesis', foreground: '52525b' },
    { token: 'operator', foreground: '18181b' },
    { token: 'tag', foreground: '09090b', fontStyle: 'bold' },
    { token: 'attribute.name', foreground: '3f3f46' },
    { token: 'attribute.value', foreground: '27272a' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#18181b',
    'editor.lineHighlightBackground': '#f4f4f5',
    'editor.selectionBackground': '#d3d3d5',
    'editorLineNumber.foreground': '#8d8e93',
    'editorLineNumber.activeForeground': '#18181b',
    'editorIndentGuide.background': '#e2e4e3',
    'editorIndentGuide.activeBackground': '#b5b5b8',
    'editorCursor.foreground': '#18181b',
  },
});

export { monaco };

