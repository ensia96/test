import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useRef, useState } from "react";

export default function Session({ websocketURL }: SessionProps) {
  const fitReference = useRef<FitAddon | null>(null);
  const inputReference = useRef<HTMLTextAreaElement | null>(null);
  const terminalReference = useRef<HTMLDivElement>(null);
  const touchOverlayReference = useRef<HTMLDivElement>(null);
  const websocketReference = useRef<WebSocket | null>(null);

  const [state, setState] = useState<SessionState>({
    ctrl: 0,
    keyboard: 0,
    opt: 0,
  });

  const handleModifier =
    (key: string) => (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      if (key === "ctrl" || key === "opt")
        setState((state) => ({
          ...state,
          [key]: 2 * +(state[key] === 1) + +(state[key] === 0),
        }));
      else {
        let dataToSend;
        if (state.ctrl !== 0 && key.length === 1)
          dataToSend = String.fromCharCode(
            key.toLowerCase().charCodeAt(0) & 0x1f,
          );
        if (state.opt !== 0) {
          if (key === "ArrowLeft") dataToSend = "\x1bb";
          if (key === "ArrowRight") dataToSend = "\x1bf";
          if (key.length === 1) dataToSend = "\x1b" + key.toLowerCase();
        }
        if (!dataToSend) dataToSend = SPECIAL_KEYS[key];
        if (dataToSend) sendData(dataToSend);
      }
      inputReference.current?.focus();
    };

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length === 1) e.preventDefault();
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length === 1) e.preventDefault();
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    e.preventDefault();
    inputReference.current?.focus();
  }, []);

  const sendData: WebSocket["send"] = (data) => {
    const websocket = websocketReference.current;
    if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
    websocket.send(data);
    setState((state) => ({
      ...state,
      ctrl: state.ctrl === 1 ? 0 : state.ctrl,
      opt: state.opt === 1 ? 0 : state.opt,
    }));
  };

  useEffect(() => {
    if (!terminalReference.current) return;
    const term = new Terminal({
      fontFamily: '"MesloLGS NF", Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
      scrollback: 2000,
      theme: {
        background: "#282828",
        black: "#282828",
        blue: "#458588",
        brightBlack: "#928374",
        brightBlue: "#83a598",
        brightCyan: "#8ec07c",
        brightGreen: "#b8bb26",
        brightMagenta: "#d3869b",
        brightRed: "#fb4934",
        brightWhite: "#ebdbb2",
        brightYellow: "#fabd2f",
        cursor: "#ebdbb2",
        cyan: "#689d6a",
        foreground: "#ebdbb2",
        green: "#98971a",
        magenta: "#b16286",
        red: "#cc241d",
        white: "#a89984",
        yellow: "#d79921",
      },
    });
    term.open(terminalReference.current);
    term.focus = () => inputReference.current?.focus();
    const xtermInput =
      terminalReference.current.querySelector<HTMLTextAreaElement>(
        ".xterm-helper-textarea",
      );
    if (xtermInput) {
      xtermInput.addEventListener("focus", () =>
        inputReference.current?.focus(),
      );
      xtermInput.setAttribute("readonly", "true");
      xtermInput.style.pointerEvents = "none";
      xtermInput.tabIndex = -1;
    }
    websocketReference.current = new WebSocket(
      websocketURL ?? `ws://${window.location.host}`,
    );
    websocketReference.current.onclose = () =>
      term.write("\r\n\x1b[33m[Disconnected]\x1b[0m\r\n");
    websocketReference.current.onopen = () => {
      term.write("\x1b[32m[Connected]\x1b[0m\r\n");
      websocketReference.current!.onmessage = (e) => {
        if (typeof e.data === "string") term.write(e.data);
        else if (e.data instanceof Blob)
          e.data.text().then((text) => term.write(text));
      };
      websocketReference.current!.send(
        JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
      );
    };
    inputReference.current = document.createElement("textarea");
    inputReference.current.addEventListener(
      "beforeinput",
      (e: InputEvent) =>
        websocketReference.current!.readyState === WebSocket.OPEN &&
        sendData(
          e.inputType === "insertText"
            ? (e.data ?? "")
            : e.inputType === "deleteContentBackward"
              ? "\x7f"
              : e.inputType === "insertLineBreak"
                ? "\r"
                : "",
        ),
    );
    inputReference.current.addEventListener("compositionend", () => {
      inputReference.current!.value = "";
    });
    inputReference.current.addEventListener("keydown", (e: KeyboardEvent) => {
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      if (!e.metaKey)
        setState((state) => {
          const isCtrl = e.ctrlKey || state.ctrl !== 0;
          const isOpt = e.altKey || state.opt !== 0;
          let dataToSend;
          if (isCtrl && !isOpt && e.key.length === 1) {
            e.preventDefault();
            dataToSend = String.fromCharCode(
              e.key.toLowerCase().charCodeAt(0) & 0x1f,
            );
          }
          if (isOpt && !isCtrl) {
            e.preventDefault();
            if (e.key === "ArrowLeft") dataToSend = "\x1bb";
            if (e.key === "ArrowRight") dataToSend = "\x1bf";
            if (e.key === "Backspace") dataToSend = "\x1b\x7f";
            if (e.key === "Delete") dataToSend = "\x1bd";
            if (e.code.startsWith("Key"))
              dataToSend =
                "\x1b" +
                e.code.slice(3)[e.shiftKey ? "toUpperCase" : "toLowerCase"]();
            if (e.code.startsWith("Digit"))
              dataToSend = "\x1b" + e.code.slice(5);
          }
          if (!dataToSend) dataToSend = SPECIAL_KEYS[e.key];
          if (dataToSend) sendData(dataToSend);
          return state;
        });
    });
    inputReference.current.style.cssText = `
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      opacity: 0;
      z-index: 10;
      resize: none;
      border: none;
      outline: none;
      caret-color: transparent;
    `;
    terminalReference.current.appendChild(inputReference.current);
    inputReference.current.focus();
    touchOverlayReference.current?.addEventListener(
      "touchstart",
      handleTouchStart,
      { passive: false },
    );
    touchOverlayReference.current?.addEventListener(
      "touchmove",
      handleTouchMove,
      { passive: false },
    );
    touchOverlayReference.current?.addEventListener(
      "touchend",
      handleTouchEnd,
      { passive: false },
    );
    touchOverlayReference.current?.addEventListener(
      "touchcancel",
      handleTouchEnd,
      { passive: false },
    );
    const fit = new FitAddon();
    fitReference.current = fit;
    term.loadAddon(fit);
    fit.fit();
    const handleResize = () => {
      if (!terminalReference.current) return;
      if (websocketReference.current?.readyState !== WebSocket.OPEN) return;
      if (window.visualViewport)
        setState((state) => ({
          ...state,
          keyboard: Math.max(
            window.innerHeight - window.visualViewport!.height,
            0,
          ),
        }));
      else {
        fit.fit();
        websocketReference.current!.send(
          JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }),
        );
      }
    };
    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("scroll", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("scroll", handleResize);
      if (touchOverlayReference.current) {
        touchOverlayReference.current.removeEventListener(
          "touchstart",
          handleTouchStart,
        );
        touchOverlayReference.current.removeEventListener(
          "touchmove",
          handleTouchMove,
        );
        touchOverlayReference.current.removeEventListener(
          "touchend",
          handleTouchEnd,
        );
        touchOverlayReference.current.removeEventListener(
          "touchcancel",
          handleTouchEnd,
        );
      }
      fitReference.current = null;
      inputReference.current?.remove();
      inputReference.current = null;
      websocketReference.current?.close();
      term.dispose();
    };
  }, [websocketURL, handleTouchStart, handleTouchMove, handleTouchEnd]);

  useEffect(() => {
    const fit = fitReference.current;
    if (!fit) return;
    fit.fit();
    const websocket = websocketReference.current;
    if (websocket?.readyState !== WebSocket.OPEN) return;
    const dimensions = fit.proposeDimensions();
    if (!dimensions) return;
    websocket.send(JSON.stringify({ type: "resize", ...dimensions }));
  }, [state.keyboard]);

  return (
    <div
      {...{
        style: {
          display: "flex",
          flexDirection: "column",
          height: `calc(100% - ${state.keyboard}px)`,
        },
      }}
    >
      <div
        {...{
          ref: terminalReference,
          style: {
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            position: "relative",
          },
        }}
      >
        <div
          {...{
            ref: touchOverlayReference,
            style: {
              background: "transparent",
              bottom: 0,
              left: 0,
              position: "absolute",
              right: 0,
              top: 0,
              touchAction: "none",
              zIndex: 20,
            },
          }}
        />
      </div>

      <div {...{ style: STYLE.KEYBAR }}>
        <div {...{ style: STYLE.GROUP }}>
          {[
            {
              children: "esc",
              handler: handleModifier("Escape"),
              style: STYLE.BUTTON,
            },
            {
              children: "ctrl",
              handler: handleModifier("ctrl"),
              style: getModifierStyle(state.ctrl),
            },
            {
              children: "opt",
              handler: handleModifier("opt"),
              style: getModifierStyle(state.opt),
            },
            {
              children: "tab",
              handler: handleModifier("Tab"),
              style: STYLE.BUTTON,
            },
          ].map(({ children, handler, style }) => (
            <button
              {...{
                children,
                key: children,
                onMouseDown: handler,
                onTouchEnd: handler,
                style,
              }}
            />
          ))}
        </div>

        <div {...{ style: STYLE.GROUP }}>
          {[
            {
              children: "←",
              handler: handleModifier("ArrowLeft"),
              style: STYLE.BUTTON,
            },
            {
              children: "↓",
              handler: handleModifier("ArrowDown"),
              style: STYLE.BUTTON,
            },
            {
              children: "↑",
              handler: handleModifier("ArrowUp"),
              style: STYLE.BUTTON,
            },
            {
              children: "→",
              handler: handleModifier("ArrowRight"),
              style: STYLE.BUTTON,
            },
          ].map(({ children, handler, style }) => (
            <button
              {...{
                children,
                key: children,
                onMouseDown: handler,
                onTouchEnd: handler,
                style,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

type ModifierState = 0 | 1 | 2;

type SessionProps = {
  websocketURL?: string;
};

type SessionState = {
  ctrl: ModifierState;
  keyboard: number;
  opt: ModifierState;
};

const SPECIAL_KEYS: Record<string, string> = {
  ArrowDown: "\x1b[B",
  ArrowLeft: "\x1b[D",
  ArrowRight: "\x1b[C",
  ArrowUp: "\x1b[A",
  Backspace: "\x7f",
  Delete: "\x1b[3~",
  End: "\x1b[F",
  Enter: "\r",
  Escape: "\x1b",
  Home: "\x1b[H",
  Tab: "\t",
};

const STYLE: Record<string, React.CSSProperties> = {
  BUTTON: {
    WebkitTapHighlightColor: "transparent",
    alignItems: "center",
    backgroundColor: "#3c3836",
    border: "1px solid #504945",
    borderRadius: 6,
    color: "#ebdbb2",
    cursor: "pointer",
    display: "flex",
    fontFamily: "system-ui, sans-serif",
    fontSize: 14,
    fontWeight: 500,
    height: 36,
    justifyContent: "center",
    touchAction: "manipulation",
    userSelect: "none",
    width: 44,
  },
  GROUP: {
    display: "flex",
    gap: 8,
  },
  KEYBAR: {
    alignItems: "center",
    backgroundColor: "#1d2021",
    borderTop: "1px solid #3c3836",
    display: "flex",
    flexShrink: 0,
    gap: 16,
    height: 48,
    justifyContent: "space-between",
  },
};

function getModifierStyle(state: ModifierState): React.CSSProperties {
  return {
    ...STYLE.BUTTON,
    backgroundColor: ["#3c3836", "#504945", "#665c54"][state],
    borderColor: ["#504945", "#fe8019"][+(state === 2)],
    borderWidth: 1 + +(state === 2),
  };
}
