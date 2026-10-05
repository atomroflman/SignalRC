// Lightweight Janus Gateway TypeScript definitions tailored for our usage.
declare global {
	interface Window {
		Janus?: JanusStatic;
	}
}

export interface JanusStatic {
	init(options: JanusInitOptions): void;
	isWebrtcSupported(): boolean;
	attachMediaStream(element: HTMLMediaElement, stream: MediaStream): void;
	useDefaultDependencies(): unknown;
	new (options: JanusOptions): Janus;
}

export interface JanusInitOptions {
	debug?: boolean | string | string[];
	dependencies?: unknown;
	callback?: () => void;
}

export interface JanusOptions {
	server: string | string[];
	iceServers?: RTCIceServer[];
	success?: () => void;
	error?: (err: string) => void;
	destroyed?: () => void;
}

export interface Janus {
	attach(options: JanusPluginOptions): void;
	destroy(options?: { cleanupHandles?: boolean }): void;
}

export interface JanusPluginOptions {
	plugin: string;
	success?: (handle: JanusPluginHandle) => void;
	error?: (err: string) => void;
	onmessage?: (msg: JanusStreamingMessage, jsep?: RTCSessionDescriptionInit) => void;
	onremotetrack?: (track: MediaStreamTrack, mid: string, on: boolean) => void;
	onremotestream?: (stream: MediaStream) => void;
}

export interface JanusPluginHandle {
	send(options: JanusSendOptions): void;
	createAnswer(options: JanusAnswerOptions): void;
	detach(): void;
	onremotetrack?: (track: MediaStreamTrack, mid: string, on: boolean) => void;
	onremotestream?: (stream: MediaStream) => void;
	getBitrate?: (mid?: string) => string;
	webrtcStuff?: {
		pc?: RTCPeerConnection;
	};
}

export interface JanusSendOptions {
	message: unknown;
	jsep?: RTCSessionDescriptionInit;
	success?: (response: any) => void;
	error?: (err: string) => void;
}

export interface JanusAnswerOptions {
	jsep: RTCSessionDescriptionInit;
	media?: {
		audioSend?: boolean;
		audioRecv?: boolean;
		videoSend?: boolean;
		videoRecv?: boolean;
	};
	success: (answer: RTCSessionDescriptionInit) => void;
	error: (err: string) => void;
}

export interface JanusStreamingMessage {
	streaming?: 'event' | 'list';
	list?: JanusStreamInfo[];
	error?: string;
	error_code?: number;
	result?: {
		status?: string;
	};
}

export interface JanusStreamInfo {
	id: number;
	description?: string;
	enabled?: boolean;
	metadata?: string;
	type?: string;
}

export {};
