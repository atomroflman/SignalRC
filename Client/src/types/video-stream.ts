// ponytail: server's GetVideoStreamsForCar returns VideoStreamMapItem (serverId),
// not VideoStreamInfoModel (id) anymore. Match the server.
export class VideoStreamMapItem {
  name?: string | null = null;
  location?: string | null = null;
  type?: string | null = null;
  streamId: string = '';
  enabled: boolean = true;
  serverId: number = 0;
  cameraDevice?: string | null = null;
  rpiCamId?: number | null = null;
  width: number = 1280;
  height: number = 720;
  framerate: number = 30;
  bitrate: number = 1500;
  modifiedAt?: Date | null = null;
  options: Record<string, unknown> = {};
  gain?: number | null = null;
  shutter?: number | null = null;
  brightness: number = 0.5;
  contrast?: number | null = null;
  ev?: number | null = null;
  exposure?: string | null = null;
  port: number = 0;
  isActive: boolean = false;
  viewerCount: number = 0;
}

export type VideoStreamInfo = {
  serverId: number;
  name: string;
  streamId: string;
  type: string;
  location?: string | null;
  width: number;
  height: number;
  bitrateKbps: number;
  framerate: number;
  brightness: number;
  gain?: number | null;
  shutter?: number | null;
  contrast?: number | null;
  ev?: number | null;
  exposure?: string | null;
  enabled: boolean;
  isActive: boolean;
  viewerCount: number;
};

export type VideoSettingsPayload = {
  width: number;
  height: number;
  framerate: number;
  bitrate: number;
  brightness: number;
  gain?: number | null;
  shutter?: number | null;
  contrast?: number | null;
  ev?: number | null;
  exposure?: string | null;
};