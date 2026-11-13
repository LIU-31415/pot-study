// 学习模式里三个下拉共用的触发器样式。
// 分开写两份很容易漂：改了一个忘了另一个，就变成"看着像一家人但边角不一样"。
export const TRIGGER_CLASS =
    'h-10 w-full min-w-0 justify-between rounded-medium bg-default-100 px-3 text-small font-normal';

// 面板高度上限：模型多、窗口矮的时候不让浮层顶出窗口
export const PANEL_MAX_HEIGHT = 'min(340px, 60vh)';
