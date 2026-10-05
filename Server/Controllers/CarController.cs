using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using LteCar.Server.Data;
using System.Security.Claims;

namespace LteCar.Server.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class CarController : ControllerBase
    {
        private readonly CarConnectionStore _connectionStore;

        public CarController(LteCarContext context, CarConnectionStore connectionStore) : base(context)
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
                subscribed = subscribedIds.Contains(c.Id),
            }));
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

            var hash = LteCar.Shared.HashUtility.GenerateSha256Hash(car.CarIdentityKey);

            return Ok(new { hash });
        }
    }
}