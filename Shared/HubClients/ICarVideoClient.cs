using LteCar.Shared.Channels;
using LteCar.Shared.Video;

namespace LteCar.Shared.HubClients;

// ponytail: subset of the merged hub's client interface used by the Onboard's
// VideoStreamService. See ITelemetryClient for the dispatch-by-method-name
// rationale.
public interface ICarVideoClient
{
    /// <summary>
    /// Used to start a video stream on the car with specified settings or change the settings of a running Stream.
    /// </summary>
    Task StartVideoStream(string streamId);
    /// <summary>
    /// Used to stop a running video stream on the car.
    /// </summary>
    Task StopVideoStream(string streamId);

    Task UpdateVideoStream(string streamId, VideoStreamMapItem settings);
}