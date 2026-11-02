using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;
using System.Security.Claims;

namespace SignalRC.Server.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class CarController : ControllerBase
    {
        private readonly CarConnectionStore _connectionStore;

        public CarController(SignalRCContext context, CarConnectionStore connectionStore) : base(context)
        {
            _connectionStore = connectionStore;
        }

        [HttpGet]
        public async Task<IActionResult> GetCars()
        {
            var cars = await _context.Cars
                .OrderBy(c => c.Name)
                .Select(c => new
                {
                    c.Id,
                    c.Name,
                    c.LastSeen,
                    IsConnected = _connectionStore.ContainsKey(c.Id.ToString())
                })
                .ToListAsync();
            return Ok(cars);
        }

        [HttpGet("{id}/functions")]
        public async Task<IActionResult> GetCarFunctions(int id)
        {
            // Check if user is authenticated
            var user = await GetCurrentUserAsync();
            if (user == null)
                return Unauthorized("User not found");

            // Check if user has a setup for this car
            var hasSetup = await _context.UserSetups
                .AnyAsync(u => u.UserId == user.Id && u.CarId == id);
            
            if (!hasSetup)
                return Unauthorized("User has no setup for this car");

            // User has access, return car functions
            var carFunctions = await _context.Set<CarChannel>().Where(c => c.CarId == id).ToListAsync();
            return Ok(carFunctions.Select(cf => new
            {
                id = cf.Id,
                displayName = cf.DisplayName,
                channelName = cf.ChannelName,
                isEnabled = cf.IsEnabled,
                requiresAxis = cf.RequiresAxis,
                maxResendInterval = cf.MaxResendInterval
            }));
        }

        [HttpGet("{id}/telemetry")]
        public async Task<IActionResult> GetCarTelemetryChannels(int id)
        {
            var user = await GetCurrentUserAsync();
            if (user == null) return Unauthorized();

            var setup = await _context.UserSetups
                .FirstOrDefaultAsync(s => s.UserId == user.Id && s.CarId == id);

            var channels = await _context.CarTelemetry.Where(c => c.CarId == id).ToListAsync();

            var subscribedIds = setup != null
                ? await _context.UserSetupTelemetries
                    .Where(t => t.UserSetupId == setup.Id)
                    .Select(t => t.CarTelemetryId)
                    .ToListAsync()
                : new List<int>();

            return Ok(channels.Select(c => new
            {
                id = c.Id,
                channelName = c.ChannelName,
                dataType = c.DataType.ToString().ToLowerInvariant(),
                unit = c.Unit,
                decimals = c.Decimals,
                readIntervalTicks = c.ReadIntervalTicks,
                zoneLimitsMm = ZoneLimits(c.OptionsJson),
                subscribed = subscribedIds.Contains(c.Id),
            }));
        }

        // LiDAR grid zone limits from the channel options (Shared/Overlay/lidar/README.md §1);
        // null when not configured, the client then uses the defaults.
        private static int[]? ZoneLimits(string? optionsJson)
        {
            if (string.IsNullOrEmpty(optionsJson)) return null;
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(optionsJson);
                if (doc.RootElement.ValueKind != System.Text.Json.JsonValueKind.Object
                    || !doc.RootElement.TryGetProperty("zoneLimitsMm", out var v)) return null;
                var parts = v.ValueKind switch
                {
                    System.Text.Json.JsonValueKind.Array => v.EnumerateArray().Select(e => e.ToString()).ToArray(),
                    System.Text.Json.JsonValueKind.String => v.GetString()!.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries),
                    _ => [],
                };
                var limits = parts.Select(p => int.TryParse(p, out var n) ? n : -1).ToArray();
                return limits.Length == 5 && limits.All(n => n > 0) ? limits : null;
            }
            catch (System.Text.Json.JsonException)
            {
                return null;
            }
        }

        [HttpGet("{carid}/setup")]
        public async Task<IActionResult> GetCarSetup(int carid)
        {
            var user = await GetCurrentUserAsync();
            if (user == null)
                return Unauthorized("User not found");

            var car = await _context.Cars
                .FirstOrDefaultAsync(c => c.Id == carid);
            if (car == null)
                return NotFound("Car not found");
            var setup = await _context.UserSetups
                .FirstOrDefaultAsync(u => u.UserId == user.Id && u.CarId == carid);

            if (setup == null)
            {
                return NotFound("Setup not found");
            }
            return Ok(new {id =setup.Id, carId = carid, userId = user.Id});
        }

        [HttpGet("{carid}/identity-hash")]
        public async Task<IActionResult> GetCarIdentityHash(int carid)
        {
            var car = await _context.Cars.FirstOrDefaultAsync(c => c.Id == carid);
            if (car == null)
                return NotFound("Car not found");

            var hash = SignalRC.Shared.HashUtility.GenerateSha256Hash(car.CarIdentityKey);

            return Ok(new { hash });
        }
    }
}