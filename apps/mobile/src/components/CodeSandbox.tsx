import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useSandboxStore } from '@/store/sandboxStore';
import { C, R, cardShadow } from '@/theme';

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
        case 'editor-change':
          // 编辑器实时内容 → store（correctCode 等 AI 工具免保存直读）
          useSandboxStore.getState().setLiveCode(msg.code ?? '');
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
    ready: '就绪',
    running: '运行中',
    error: '运行时加载失败（检查网络）',
  };
  const statusColor: Record<RunStatus, string> = {
    loading: C.text3,
    ready: C.green,
    running: C.orange,
    error: C.red,
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
          activeOpacity={0.85}
          accessibilityLabel="运行代码"
        >
          <Ionicons name="play" size={13} color="#fff" />
          <Text style={styles.runBtnText}>{status === 'running' ? '运行中…' : '运行'}</Text>
        </TouchableOpacity>
      </View>

      {/* 控制台输出 */}
      <View style={styles.labelRow}>
        <View style={[styles.statusDot, { backgroundColor: statusColor[status] }]} />
        <Text style={styles.label}>
          控制台 · {statusText[status]}
        </Text>
      </View>
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
          placeholderTextColor={C.text3}
          value={name}
          onChangeText={(t) => {
            setName(t);
            nameRef.current = t; // 输入实时同步到 ref：异步回传前连点保存也不会丢名字
          }}
        />
        <TouchableOpacity
          style={styles.saveBtn}
          activeOpacity={0.85}
          onPress={() => {
            // 保存的是编辑器当前内容：让 WebView 把代码回传后落盘
            webRef.current?.postMessage(JSON.stringify({ type: 'export' }));
          }}
        >
          <Ionicons name="save" size={14} color="#fff" />
          <Text style={styles.saveBtnText}>保存片段</Text>
        </TouchableOpacity>
      </View>
      {saveHint && (
        <View style={styles.saveHintRow}>
          <Ionicons name="checkmark-circle" size={13} color={C.green} />
          <Text style={styles.saveHint}>{saveHint}</Text>
        </View>
      )}

      {/* 片段列表 */}
      {snippets.map((s) => (
        <View key={s.id} style={styles.snippetRow}>
          <TouchableOpacity style={styles.snippetMain} onPress={() => loadSnippet(s.code)} activeOpacity={0.85}>
            <Ionicons name="document-text" size={15} color={C.primary} />
            <Text style={styles.snippetName} numberOfLines={1}>
              {s.name}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.snippetDel}
            onPress={() => remove(s.id)}
            activeOpacity={0.85}
            accessibilityLabel={`删除片段 ${s.name}`}
          >
            <Ionicons name="close" size={16} color={C.text3} />
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  editorWrap: { flex: 5, borderRadius: R.md, overflow: 'hidden', ...cardShadow },
  runBtn: {
    position: 'absolute',
    right: 12,
    top: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: C.primary,
    borderRadius: R.sm,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#3B2D6B',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  runBtnBusy: { backgroundColor: C.primaryDeep },
  runBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, marginBottom: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  label: { fontSize: 12, color: C.text2, fontWeight: '500' },
  // 控制台保留终端深底（代码语境），但换成与紫罗兰色板呼应的深墨紫
  console: { flex: 2, backgroundColor: '#241F3A', borderRadius: R.md, padding: 12 },
  logLine: { color: '#C7E8D5', fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
  logEmpty: { color: '#6A6489', fontSize: 12 },
  saveRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  saveInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: C.card,
    color: C.text,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: C.primary,
    borderRadius: R.sm,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  saveHintRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  saveHint: { fontSize: 12, color: C.green, fontWeight: '500' },
  snippetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    backgroundColor: C.card,
    borderRadius: R.sm,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  snippetMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  snippetName: { fontSize: 14, color: C.text, flex: 1 },
  snippetDel: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
