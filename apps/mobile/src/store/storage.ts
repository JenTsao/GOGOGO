import { MMKV } from 'react-native-mmkv';

// 全局 MMKV 实例：所有 store / lib 统一从这里导入。
// 独立成模块是为了斩断 store 间循环依赖——此前 taskStore 导出 storage、settingsStore 反向导入，
// 若 taskStore 先被加载，settingsStore 在模块求值期会拿到 undefined 的 storage 直接崩溃。
export const storage = new MMKV({ id: 'gaokao-store' });
