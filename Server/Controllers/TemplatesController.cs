using LteCar.Server.Data;
using LteCar.Server.Hubs;
using LteCar.Server.Services;
using LteCar.Shared.Channels;
using LteCar.Shared.HubClients;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace LteCar.Server.Controllers;

[ApiController]
[Route("api/templates")]
public class TemplatesController : Server.Controllers.ControllerBase
{
    private readonly ChannelTemplateService _templateService;
    private readonly IHubContext<CarConnectionHub, IConnectionHubClient> _controlHub;
    private readonly ILogger<TemplatesController> _logger;

    public TemplatesController(
        LteCarContext context,
        ChannelTemplateService templateService,
        IHubContext<CarConnectionHub, IConnectionHubClient> controlHub,
        ILogger<TemplatesController> logger) : base(context)
    {
        _templateService = templateService;
        _controlHub = controlHub;
        _logger = logger;
    }

    /// <summary>
    /// Lists all available vehicle hardware templates.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetTemplates()
    {
        var templates = await _context.ChannelTemplates
            .AsNoTracking()
            .OrderBy(t => t.Name)
            .Select(t => new
            {
                t.Id,
                t.Key,
                t.Name,
                t.Description,
                t.Version,
                t.Author,
                t.ChannelMapHash,
                t.CreatedAt,
                t.UpdatedAt
            })
            .ToListAsync();

        return Ok(templates);
    }

    /// <summary>
    /// Returns a single template including its channel map.
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetTemplate(int id)
    {
        var template = await _context.ChannelTemplates.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id);
        if (template == null) return NotFound();

        var map = _templateService.GetTemplateChannelMap(template);
        return Ok(new
        {
            template.Id,
            template.Key,
            template.Name,
            template.Description,
            template.Version,
            template.Author,
            template.ChannelMapHash,
            template.CreatedAt,
            template.UpdatedAt,
            ChannelMap = map
        });
    }

    /// <summary>
    /// Applies a template to a car, replacing the car's channel configuration.
    /// If the car is currently connected, the new channel map is pushed immediately.
    /// </summary>
    [HttpPost("cars/{carId:int}/apply/{templateId:int}")]
    public async Task<IActionResult> ApplyTemplate(int carId, int templateId)
    {
        var car = await _context.Cars.FirstOrDefaultAsync(c => c.Id == carId);
        if (car == null) return NotFound("Car not found.");

        var template = await _context.ChannelTemplates.FirstOrDefaultAsync(t => t.Id == templateId);
        if (template == null) return NotFound("Template not found.");

        await _templateService.ApplyTemplateAsync(carId, templateId);

        // Reload the saved map so we can push it to a connected car.
        var map = await ChannelMapMapper.FromDbAsync(carId, _context);
        var hash = ChannelMapHashProvider.GenerateHash(map);

        try
        {
            await _controlHub.Clients.Group($"Car-{carId}").ApplyChannelMap(map, hash);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to push applied template to car {CarId}; it will receive the config on next connect.", carId);
        }

        return Ok(new { carId, templateId, ChannelMapHash = hash });
    }
}
