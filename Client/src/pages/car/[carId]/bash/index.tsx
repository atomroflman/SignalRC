import React, { JSX, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { HubConnection, HubConnectionBuilder, LogLevel } from "@microsoft/signalr";
import LanguageSwitcher from "@/components/language-switcher";
import { useI18n } from "@/i18n/provider";

type OutputLine = { text: string; isError?: boolean; time: string };

export default function CarBashPage(): JSX.Element {
    const { messages } = useI18n();
    const router = useRouter();
    const carId = Array.isArray(router.query.carId) ? router.query.carId[0] : router.query.carId;
    const [output, setOutput] = useState<OutputLine[]>([]);
    const [connected, setConnected] = useState(false);
    const [inputValue, setInputValue] = useState("");
    const carUiConn = useRef<HubConnection | null>(null);
    const carControlConn = useRef<HubConnection | null>(null);
    const outputRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!carId) return;

        var uiConnection = new HubConnectionBuilder()
            .withUrl("/hubs/connection")
            .withAutomaticReconnect()
            .configureLogging(LogLevel.Warning)
            .build();

        var controlConnection = new HubConnectionBuilder()
            .withUrl("/hubs/connection")
            .withAutomaticReconnect()
            .configureLogging(LogLevel.Warning)
            .build();

        uiConnection.on("SendBashOutput", (incomingCarId: number, text: string, isError: boolean) => {
            if (String(incomingCarId) !== String(carId)) return;
            appendOutput(text, isError);
        });

        const startBoth = async () => {
            try {
                await uiConnection.start();
                await controlConnection.start();
                carUiConn.current = uiConnection;
                carControlConn.current = controlConnection;
                setConnected(true);
            } catch (ex) {
                console.error("SignalR start failed", ex);
                setConnected(false);
            }
        };

        startBoth();

        return () => {
            uiConnection.stop().catch(() => {});
            controlConnection.stop().catch(() => {});
            carUiConn.current = null;
            carControlConn.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [carId]);

    useEffect(() => {
        // auto-scroll
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [output]);

    function appendOutput(text: string, isError = false) {
        var lines = text.split(/\r?\n/).filter(Boolean);
        if (lines.length === 0) return;
        setOutput(prev => [
            ...prev,
            ...lines.map(l => ({ text: l, isError, time: new Date().toLocaleTimeString() }))
        ]);
    }

    async function sendChunk(chunk: string) {
        if (!carControlConn.current) return;
        try {
            // Send bash command via the merged hub. sessionId is unknown on the client;
            // the server previously threw NotImplementedException for this so the path was
            // already broken — left here for context. The Onboard's BashToolService +
            // CarBashHub are the actual bash path; wiring the UI to those is a separate task.
            await carControlConn.current.invoke("ExecuteBashCommand", Number(carId), "", chunk);
        } catch (ex) {
            appendOutput(messages.bashPage.sendFailed(String(ex)), true);
        }
    }

    // Send whenever a newline is present in the input (handles paste + typing).
    async function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
        var value = e.target.value;
        // if newline present, split and send each chunk up to newline
        while (true) {
            var idx = value.indexOf("\n");
            if (idx === -1) break;
            var chunk = value.slice(0, idx + 1); // include newline as requested
            await sendChunk(chunk);
            value = value.slice(idx + 1);
        }
        setInputValue(value);
    }

    // Prevent default Enter behavior in textarea (we still allow newline via composition/paste)
    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key === "Enter" && !e.shiftKey) {
            // prevent adding an extra newline; we rely on change handler to detect newline
            e.preventDefault();
            // manually trigger sending the current value followed by newline
            var toSend = inputValue + "\n";
            setInputValue("");
            // fire-and-forget
            sendChunk(toSend);
        }
    }

    return (
        <div style={{ padding: 12, height: "100vh", display: "flex", flexDirection: "column", gap: 8, background: "linear-gradient(180deg, #12141a 0%, #0e1015 100%)", color: "#e5e7eb" }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.34em", textTransform: "uppercase", color: "#7dd3fc", padding: "2px 0 6px 0" }}>
                {messages.bashPage.title}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>{messages.bashPage.pageTitle(String(carId))}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <LanguageSwitcher />
                    <div>{connected ? messages.common.connected : messages.common.disconnected}</div>
                </div>
            </div>

            <div
                ref={outputRef}
                style={{
                    flex: 1,
                    background: "#000",
                    color: "#eee",
                    padding: 8,
                    borderRadius: 4,
                    overflow: "auto",
                    fontFamily: "monospace",
                    fontSize: 13
                }}
            >
                {output.map((line, i) => (
                    <div key={i} style={{ color: line.isError ? "#ff6b6b" : "#e6e6e6" }}>
                        <span style={{ color: "#666", marginRight: 8 }}>[{line.time}]</span>
                        {line.text}
                    </div>
                ))}
            </div>

            <textarea
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={messages.bashPage.placeholder}
                style={{
                    resize: "none",
                    height: 80,
                    fontFamily: "monospace",
                    fontSize: 13,
                    padding: 8,
                    borderRadius: 4
                }}
            />
        </div>
    );
}