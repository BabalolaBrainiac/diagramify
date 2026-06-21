import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeCodebase } from '../core/analyze.js';

let tempRoot: string | undefined;

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

function writeFixture(path: string, content: string): void {
  const fullPath = join(tempRoot!, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

describe('analyzeCodebase .NET support', () => {
  it('detects .NET entry points, modules, dependencies, endpoints, and project links', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'diagramify-dotnet-'));

    writeFixture('docker-compose.yml', `services:
  accountservice.api:
    image: accountservice
  accountservice.database:
    image: postgres:17
  accountservice.redis:
    image: redis:latest
  accountservice.rabbitmq:
    image: rabbitmq:3-management
`);
    writeFixture('src/API/AccountService.Api/Program.cs', `using AccountService.Modules.Customers.Presentation;
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
app.MapGet("api/v{version}/health", () => "ok");
app.MapEndpoints();
app.Run();
`);
    writeFixture('src/API/AccountService.Api/AccountService.Api.csproj', `<Project Sdk="Microsoft.NET.Sdk.Web">
  <ItemGroup>
    <PackageReference Include="Serilog.Sinks.Seq" Version="8.0.0" />
    <ProjectReference Include="..\\..\\Modules\\Customers\\AccountService.Modules.Customers.Presentation\\AccountService.Modules.Customers.Presentation.csproj" />
  </ItemGroup>
</Project>
`);
    writeFixture('src/Modules/Customers/AccountService.Modules.Customers.Presentation/CustomersRoute.cs', `internal sealed class CustomersRoute : IEndpoint
{
  public void MapEndpoint(IEndpointRouteBuilder app)
  {
    app.MapPost("api/v{version}/customers", () => Results.Ok());
  }
}`);
    writeFixture('src/Modules/Customers/AccountService.Modules.Customers.Presentation/AccountService.Modules.Customers.Presentation.csproj', `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <ProjectReference Include="..\\AccountService.Modules.Customers.Application\\AccountService.Modules.Customers.Application.csproj" />
  </ItemGroup>
</Project>`);
    writeFixture('src/Modules/Customers/AccountService.Modules.Customers.Application/AccountService.Modules.Customers.Application.csproj', `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="8.0.11" />
    <PackageReference Include="MassTransit.RabbitMQ" Version="8.2.5" />
    <ProjectReference Include="..\\..\\..\\Common\\AccountService.Common.Application\\AccountService.Common.Application.csproj" />
  </ItemGroup>
</Project>`);
    writeFixture('src/Common/AccountService.Common.Application/AccountService.Common.Application.csproj', `<Project Sdk="Microsoft.NET.Sdk" />`);

    const analysis = await analyzeCodebase(tempRoot, 30);

    expect(analysis.entryPoints).toContain('src/API/AccountService.Api/Program.cs');
    expect(analysis.serviceDirectories).toContain('Customers');
    expect(analysis.detectedServices).toEqual(expect.arrayContaining(['PostgreSQL', 'RabbitMQ', 'Seq', 'postgres', 'redis']));
    expect(analysis.apiEndpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'GET', path: 'api/v{version}/health' }),
      expect.objectContaining({ method: 'POST', path: 'api/v{version}/customers' }),
    ]));
    expect(analysis.internalLinks).toEqual(expect.arrayContaining([
      { from: 'API', to: 'Customers' },
      { from: 'Customers', to: 'Common' },
    ]));
  });
});
