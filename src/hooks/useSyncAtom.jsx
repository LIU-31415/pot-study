import { useAtom } from 'jotai';

import { useGetState } from './useGetState';

export const useSyncAtom = (atom) => {
    const [atomValue, setAtomValue] = useAtom(atom);
    const [localValue, setLocalValue, getLocalValue] = useGetState(atomValue);

    // 传了值就同步该值：setLocalValue 之后 getLocalValue 仍读得到旧值
    // （useGetState 的 ref 要等下一次 render 才更新），所以清空这类操作要显式传入。
    const syncAtom = (v) => setAtomValue(v === undefined ? getLocalValue() : v);

    return [localValue, setLocalValue, syncAtom];
};
