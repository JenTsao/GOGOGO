import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSandboxStore } from '@/store/sandboxStore';

// 资产由 Expo 打包（Monaco + Pyodide 从 CDN 加载，postMessage 双向桥接）
const SANDBOX_HTML = require('../../assets/sandbox/sandbox.html');

type RunStatus = 'loading' | 'ready' | 'running' | 'error';

// 代码沙盒：Monaco 编辑 + Pyodide 运行 + 5 秒无响应强制熔断 + 片段保存
export function CodeSandbox() {
  const webRef = useRef<WebView>(null);
  const fuseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameRef = useRef(''); // 保存片段时的暂存名（export 异步回传前记录）
  const [status, setStatus] = useState<RunStatus>('loading');
  const [logs, setLogs] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [saveHint, setSaveHint] = useState<string | null>(null); // 保存成功反馈（异步回传后才算落盘）
  const { snippets, save, remove } = useSandboxStore();

  // 熔断：Run 后 5 秒无任何输出/完成消息 → 杀进程（reload WebView）
  const armFuse = useCallback(() => {
    if (fuseRef.current) clearTimeout(fuseRef.current);
    fuseRef.current = setTimeout(() => {
      webRef.current?.reload();
      setStatus('loading');
      setLogs((l) => [...l, '⏱ 5 秒无响应，进程已被强制熔断']);
    }, 5000);
  }, []);

  const disarmFuse = useCallback(() => {
    if (fuseRef.current) {
      clearTimeout(fuseRef.current);
      fuseRef.current = null;
    }
  }, []);

  useEffect(() => disarmFuse, [disarmFuse]);

  const onMessage = useCallback(
    (e: { nativeEvent: { data: string } }) => {
      let msg: { type: string; text?: string; code?: string };
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'py-ready':
          setStatus('ready');
          break;
        case 'log':
          setLogs((l) => [...l, msg.text ?? '']);
          if (fuseRef.current) armFuse(); // 有输出说明活着，重置熔断计时
          break;
        case 'error':
          setLogs((l) => [...l, `加载失败：${msg.text}`]);
          setStatus('error');
          break;
        case 'done':
          disarmFuse();
          setStatus('ready');
          break;
        case 'code-value':
          save(nameRef.current, msg.code ?? '');
          setSaveHint(`已保存「${nameRef.current.trim() || '未命名片段'}」`);
          // 落盘成功后才清空输入框（点击保存时立即清空会让连点第二次用空名覆盖）
          setName('');
          nameRef.current = '';
          break;
      }
    },
    [armFuse, disarmFuse, save]
  );

  const run = () => {
    if (status !== 'ready') return;
    setLogs([]);
    setStatus('running');
    armFuse();
    webRef.current?.postMessage(JSON.stringify({ type: 'run' }));
  };

  const loadSnippet = (code: string) => {
    webRef.current?.postMessage(JSON.stringify({ type: 'code', code }));
  };

  const statusText: Record<RunStatus, string> = {
    loading: '加载中…',
    ready: '● 就绪',
    running: '● 运行中',
    error: '● 运行时加载失败（检查网络）',
  };

  return (
    <View style={styles.wrap}>
      {/* 编辑器 + 运行（WebView 内 Monaco） */}
      <View style={styles.editorWrap}>
        <WebView
          ref={webRef}
          source={SANDBOX_HTML}
          originWhitelist={['*']}
          onMessage={onMessage}
          // 页面加载失败（CDN 断网等）时 status 会卡在 loading，必须显式降级到 error
          onError={() => {
            setStatus('error');
            setLogs((l) => [...l, '❌ 沙盒页面加载失败，请检查网络后重试']);
          }}
          javaScriptEnabled
          domStorageEnabled
        />
        <TouchableOpacity
          style={[styles.runBtn, status === 'running' && styles.runBtnBusy]}
          onPress={run}
          disabled={status !== 'ready'}
        >
          <Text style={styles.runBtnText}>{status === 'running' ? '运行中…' : '▶ 运行'}</Text>
        </TouchableOpacity>
      </View>

      {/* 控制台输出 */}
      <Text style={styles.label}>
        控制台 · {statusText[status]}
      </Text>
      <ScrollView style={styles.console}>
        {logs.map((l, i) => (
          <Text key={i} style={styles.logLine}>
            {l}
          </Text>
        ))}
        {logs.length === 0 && <Text style={styles.logEmpty}>（暂无输出）</Text>}
      </ScrollView>

      {/* 保存片段 */}
      <View style={styles.saveRow}>
        <TextInput
          style={styles.saveInput}
          placeholder="片段名称"
          placeholderTextColor="#999"
          value={name}
          onChangeText={(t) => {
            setName(t);
            nameRef.current = t; // 输入实时同步到 ref：异步回传前连点保存也不会丢名字
          }}
        />
        <TouchableOpacity
          style={styles.saveBtn}
          onPress={() => {
            // 保存的是编辑器当前内容：让 WebView 把代码回传后落盘
            webRef.current?.postMessage(JSON.stringify({ type: 'export' }));
          }}
        >
          <Text style={styles.saveBtnText}>💾 保存片段</Text>
        </TouchableOpacity>
      </View>
      {saveHint && <Text style={styles.saveHint}>{saveHint}</Text>}

      {/* 片段列表 */}
      {snippets.map((s) => (
        <View key={s.id} style={styles.snippetRow}>
          <TouchableOpacity style={styles.snippetMain} onPress={() => loadSnippet(s.code)}>
            <Text style={styles.snippetName}>📄 {s.name}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.snippetDel} onPress={() => remove(s.id)}>
            <Text style={styles.snippetDelText}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  editorWrap: { flex: 5, borderRadius: 12, overflow: 'hidden' },
  runBtn: {
    position: 'absolute',
    right: 12,
    top: 12,
    backgroundColor: '#111',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  runBtnBusy: { backgroundColor: '#555' },
  runBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  label: { marginTop: 10, marginBottom: 4, fontSize: 12, color: '#888' },
  console: { flex: 2, backgroundColor: '#111', borderRadius: 12, padding: 10 },
  logLine: { color: '#c8e6c9', fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
  logEmpty: { color: '#555', fontSize: 12 },
  saveRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  saveInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 14,
    backgroundColor: '#fff',
  },
  saveBtn: { backgroundColor: '#111', borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  saveHint: { marginTop: 6, fontSize: 12, color: '#1c5d2c' },
  snippetRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  snippetMain: { flex: 1 },
  snippetName: { fontSize: 14, color: '#333', paddingVertical: 4 },
  snippetDel: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  snippetDelText: { color: '#999' },
});
