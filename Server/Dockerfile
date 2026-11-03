FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Install git so the MSBuild fallback can resolve branch/commit from copied .git metadata,
# and zip for the onboard packages.
# Runs before any ARG/COPY so the layer stays cached until the base image changes.
RUN apt-get update && apt-get install -y --no-install-recommends git zip && rm -rf /var/lib/apt/lists/*

# Restore against the project files only, so NuGet packages stay cached
# as long as no .csproj changes.
COPY Server/SignalRC.Server.csproj Server/
COPY Shared/SignalRC.Shared.csproj Shared/
COPY Onboard/SignalRC.Onboard.csproj Onboard/
RUN dotnet restore Server/SignalRC.Server.csproj \
 && dotnet restore Onboard/SignalRC.Onboard.csproj -r linux-arm64 \
 && dotnet restore Onboard/SignalRC.Onboard.csproj -r linux-x64

# Copy git metadata so MSBuild can resolve the current branch/commit during publish.
# The build stage is discarded, so this does not bloat the runtime image.
COPY .git .git

COPY Server/ Server/
COPY Shared/ Shared/
COPY Onboard/ Onboard/

# Declared this late on purpose: every RUN after an ARG misses the cache when its value changes.
ARG GIT_BRANCH
ARG GIT_COMMIT
RUN dotnet publish Server/SignalRC.Server.csproj -c Release -o /app/publish /p:UseAppHost=false \
    /p:BuildInfoBranch="$GIT_BRANCH" /p:BuildInfoCommit="$GIT_COMMIT"

# Onboard packages for the self-update (Docs/OnboardAutoUpdate.md), one ZIP per
# architecture from the same commit as the server. Framework-dependent: the vehicles
# have the .NET runtime. Vehicle config never goes into a package. A failing
# onboard build fails the whole image on purpose.
RUN set -e; mkdir -p /app/onboard-packages; \
    for rid in linux-arm64 linux-x64; do \
      dotnet publish Onboard/SignalRC.Onboard.csproj -c Release -r "$rid" --self-contained false \
        -o "/onboard/$rid" /p:UseAppHost=false \
        /p:BuildInfoBranch="$GIT_BRANCH" /p:BuildInfoCommit="$GIT_COMMIT"; \
      (cd "/onboard/$rid" && zip -qr "/app/onboard-packages/$rid.zip" . \
        -x appSettings.json appSettings.development.json channelMap.json); \
    done

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
# ffmpeg is used by VideoStreamReceiverService to relay
# the TCP stream from the Onboard to Janus via RTP.
# Installed first so the layer stays cached across code changes.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV ASPNETCORE_URLS=http://0.0.0.0:5000
EXPOSE 5000
COPY --from=build /app/publish .
# Served by OnboardPackagesController.
COPY --from=build /app/onboard-packages /app/onboard-packages
# The onboard install script template is read at runtime by OnboardInstallScriptService.
COPY install.sh /app/install.sh
# Vehicle hardware templates are seeded into the database on startup.
RUN mkdir -p /app/VehicleTemplates
COPY VehicleTemplates /app/VehicleTemplates
ENTRYPOINT ["dotnet", "SignalRC.Server.dll"]
