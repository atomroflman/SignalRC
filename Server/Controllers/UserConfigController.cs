using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using LteCar.Server.Data;

namespace LteCar.Server.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class UserConfigController : ControllerBase
    {
        private new readonly LteCarContext _context;

        public UserConfigController(LteCarContext context) : base(context)
        {
            _context = context;
        }

        [HttpGet("setup/{carId}")]
        public async Task<IActionResult> GetSetup(int carId)
        {
            var user = await GetCurrentUserAsync();
            if (user == null)
                return Unauthorized("User not found");

            var car = await _context.Cars
                .FirstOrDefaultAsync(c => c.Id == carId);
            if (car == null)
                return NotFound("Car not found");
            var setup = await _context.UserSetups
                .FirstOrDefaultAsync(u => u.UserId == user.Id && u.CarId == carId);

            if (setup == null)
            {
                return NotFound("Setup not found");
            }

            return Ok(new
            {
                id = setup.Id,
                carId = car.Id,
                userId = user.Id,
            });
        }

        // Gibt alle verfügbaren Filtertypen zurück
        [HttpGet("filtertypes")]
        public async Task<IActionResult> GetFilterTypes()
        {
            var types = await _context.SetupFilterTypes.ToListAsync();
            return Ok(types);
        }

        // Prüft ob der Benutzer Zugriff auf die Konfiguration eines Fahrzeugs hat
        [HttpGet("has-config-access/{carId}")]
        public async Task<IActionResult> HasConfigAccess(int carId)
        {
            var user = await GetCurrentUserAsync();
            if (user == null)
                return Unauthorized("User not found");

            var hasAccess = await _context.UserSetups
                .AnyAsync(u => u.UserId == user.Id && u.CarId == carId);

            return Ok(new { hasAccess });
        }

        // Gibt alle Gamepads des Users zurück
        [HttpGet("gamepads")]
        public async Task<IActionResult> GetUserGamepads()
        {
            var user = await GetCurrentUserAsync();
            if (user == null)
                return Unauthorized("User not found");
            var gamepads = _context.Set<UserChannelDevice>()
                .Where(g => g.UserId == user.Id);
            return Ok(await gamepads.Select(e => new
            {
                id = e.Id,
                name = e.DeviceName,
                axes = e.Channels.Where(c => c.IsAxis).Select(c => new
                {
                    id = c.Id,
                    channelId = c.ChannelId,
                    name = c.Name,
                    calibrationMin = c.CalibrationMin,
                    calibrationMax = c.CalibrationMax,
                    accuracy = c.Accuracy
                }),
                buttons = e.Channels.Where(c => !c.IsAxis).Select(c => new
                {
                    id = c.Id,
                    name = c.Name,
                    channelId = c.ChannelId
                })
            }).ToListAsync());
        }

        static object _registerGamepadLock = new object();

        [HttpPost("register-gamepad")]
        public async Task<IActionResult> RegisterUserGamepad([FromBody] RegisterGamepadRequest req)
        {
            var user = await GetCurrentUserAsync();
            if (user == null)
                return Unauthorized("User not found");
            if (string.IsNullOrEmpty(req.DeviceName))
                return BadRequest("Device name is required");
            if (req.Axes < 0 || req.Buttons < 0)
                return BadRequest("Axes and buttons must be non-negative");
            if (req.Axes == 0 && req.Buttons == 0)
                return BadRequest("At least one axis or button must be defined");
            lock (_registerGamepadLock)
            {
                var exists = _context.Set<UserChannelDevice>()
                    .FirstOrDefault(g => g.UserId == user.Id && g.DeviceName == req.DeviceName);
                if (exists is not null)
                    return Ok(new
                    {
                        id = exists.Id,
                        name = exists.DeviceName,
                        axes = _context.Set<UserChannel>()
                            .Where(c => c.UserChannelDeviceId == exists.Id && c.IsAxis)
                            .Select(c => new
                            {
                                id = c.Id,
                                channelId = c.ChannelId,
                                name = c.Name,
                                calibrationMin = c.CalibrationMin,
                                calibrationMax = c.CalibrationMax,
                                accuracy = c.Accuracy
                            }),
                        buttons = _context.Set<UserChannel>()
                            .Where(c => c.UserChannelDeviceId == exists.Id && !c.IsAxis)
                            .Select(c => new
                            {
                                id = c.Id,
                                name = c.Name,
                                channelId = c.ChannelId
                            })
                    });
                var gamepad = new UserChannelDevice
                {
                    UserId = user.Id,
                    DeviceName = req.DeviceName,
                };
                _context.Set<UserChannelDevice>().Add(gamepad);
                for (int i = 0; i < req.Axes; i++)
                {
                    _context.Set<UserChannel>().Add(new UserChannel
                    {
                        UserChannelDevice = gamepad,
                        CalibrationMax = 1,
                        CalibrationMin = -1,
                        IsAxis = true,
                        ChannelId = i,
                        Name = $"Axis {i + 1}"
                    });
                }
                for (int i = 0; i < req.Buttons; i++)
                {
                    _context.Set<UserChannel>().Add(new UserChannel
                    {
                        UserChannelDevice = gamepad,
                        IsAxis = false,
                        ChannelId = i,
                        Name = $"Button {i + 1}"
                    });
                }
                _context.SaveChanges();
                return Ok(new
                {
                    id = gamepad.Id,
                    name = gamepad.DeviceName,
                    axes = _context.Set<UserChannel>()
                        .Where(c => c.UserChannelDeviceId == gamepad.Id && c.IsAxis)
                        .Select(c => new
                        {
                            id = c.Id,
                            name = c.Name,
                            calibrationMin = c.CalibrationMin,
                            calibrationMax = c.CalibrationMax
                        }),
                    buttons = _context.Set<UserChannel>()
                        .Where(c => c.UserChannelDeviceId == gamepad.Id && !c.IsAxis)
                        .Select(c => new
                        {
                            id = c.Id,
                                name = c.Name
                        })
                });
            }
        }

        [HttpPost("gamepad-axis-accuracy")]
        public async Task<IActionResult> SetGamepadAxisAccuracy([FromBody] SetGamepadAxisAccuracyRequest req)
        {
            var user = await GetCurrentUserAsync();
            if (user == null)
                return Unauthorized("User not found");
            var channel = _context.Set<UserChannel>()
                .FirstOrDefault(c => c.ChannelId == req.ChannelIndex
                    && c.UserChannelDevice.UserId == user.Id
                    && c.IsAxis
                    && c.UserChannelDevice.DeviceName == req.GamepadId);
            if (channel == null)
                return NotFound("Channel not found");
            channel.Accuracy = req.Accuracy;
            _context.SaveChanges();
            return Ok();
        }


        public class RegisterGamepadRequest
        {
            public string DeviceName { get; set; } = string.Empty;
            public int Axes { get; set; }
            public int Buttons { get; set; }
        }
    }

    public class SetGamepadAxisAccuracyRequest
    {
        public string GamepadId { get; set; } = string.Empty;
        public int ChannelIndex { get; set; }
        public int Accuracy { get; set; }
    }
}
