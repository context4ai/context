export interface ChatInputProps {
  value: string;
  onChange?: (value: string) => void;
}

export interface ChatInputRef {
  focus: () => void;
}

declare function forwardRef<TRef, TProps>(
  render: (props: TProps, ref: TRef) => unknown,
): unknown;

export const ChatInput = forwardRef<ChatInputRef, ChatInputProps>((props: ChatInputProps, ref) => {
  void props;
  void ref;
  return null;
});

export const TinyIcon = () => <svg />;
