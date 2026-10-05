FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG GIT_BRANCH
ARG GIT_COMMIT
WORKDIR /src

# Install git so the MSBuild fallback can resolve branch/commit from copied .git metadata.
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Copy git metadata so MSBuild can resolve the current branch/commit during publish.
# The build stage is discarded, so this does not bloat the runtime image.
COPY .git .git

COPY Server/ Server/
COPY Shared/ Shared/

RUN dotnet restore Server/LteCar.Server.csproj
RUN dotnet publish Server/LteCar.Server.csproj -c Release -o /app/publish /p:UseAppHost=false \
    /p:BuildInfoBranch="$GIT_BRANCH" /p:BuildInfoCommit="$GIT_COMMIT"

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_URLS=http://0.0.0.0:5000
EXPOSE 5000
COPY --from=build /app/publish .
# The onboard install script template is read at runtime by OnboardInstallScriptService.
COPY install.sh /app/install.sh
# Vehicle hardware templates are seeded into the database on startup.
COPY VehicleTemplates /app/VehicleTemplates
# ffmpeg is used by VideoStreamReceiverService to relay
# the TCP stream from the Onboard to Janus via RTP.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["dotnet", "LteCar.Server.dll"]
