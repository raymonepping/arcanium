// provider.go — terraform-provider-arcanium, Prompt 28 Deliverable 4.
//
// Skeleton only: proves a real `terraform apply` against a running Arcanium
// stack, authenticated as a service account (Deliverable 1/2), can create an
// application and read back its intent view. Not published to the Registry.
package provider

import (
	"context"
	"os"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/provider/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

// Ensure the implementation satisfies the expected interfaces.
var _ provider.Provider = &ArcaniumProvider{}

type ArcaniumProvider struct {
	// version is set by main.go at build time (ldflags), following the
	// terraform-plugin-framework scaffold's own convention.
	version string
}

func New(version string) func() provider.Provider {
	return func() provider.Provider {
		return &ArcaniumProvider{version: version}
	}
}

type providerModel struct {
	Endpoint types.String `tfsdk:"endpoint"`
	Token    types.String `tfsdk:"token"`
}

func (p *ArcaniumProvider) Metadata(_ context.Context, _ provider.MetadataRequest, resp *provider.MetadataResponse) {
	resp.TypeName = "arcanium"
	resp.Version = p.version
}

func (p *ArcaniumProvider) Schema(_ context.Context, _ provider.SchemaRequest, resp *provider.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Manages Arcanium applications through the same /api/v1 " +
			"surface Deliverable 1/2's service accounts authenticate against. " +
			"A skeleton proof, not a published provider.",
		Attributes: map[string]schema.Attribute{
			"endpoint": schema.StringAttribute{
				Optional: true,
				Description: "Arcanium API base URL, e.g. http://localhost:3001. " +
					"Falls back to the ARCANIUM_API_ENDPOINT environment variable.",
			},
			"token": schema.StringAttribute{
				Optional:  true,
				Sensitive: true,
				Description: "Service-account bearer token (Deliverable 1/2). " +
					"Falls back to the ARCANIUM_API_TOKEN environment variable.",
			},
		},
	}
}

func (p *ArcaniumProvider) Configure(ctx context.Context, req provider.ConfigureRequest, resp *provider.ConfigureResponse) {
	var cfg providerModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &cfg)...)
	if resp.Diagnostics.HasError() {
		return
	}

	endpoint := cfg.Endpoint.ValueString()
	if endpoint == "" {
		endpoint = os.Getenv("ARCANIUM_API_ENDPOINT")
	}
	if endpoint == "" {
		resp.Diagnostics.AddError(
			"Missing Arcanium API endpoint",
			"Set the provider's `endpoint` attribute or the ARCANIUM_API_ENDPOINT environment variable.",
		)
	}

	token := cfg.Token.ValueString()
	if token == "" {
		token = os.Getenv("ARCANIUM_API_TOKEN")
	}
	if token == "" {
		resp.Diagnostics.AddError(
			"Missing Arcanium API token",
			"Set the provider's `token` attribute or the ARCANIUM_API_TOKEN environment "+
				"variable to a service-account token issued via "+
				"POST /api/v1/service-accounts/{id}/tokens (Deliverable 1/2).",
		)
	}
	if resp.Diagnostics.HasError() {
		return
	}

	client := NewClient(endpoint, token)
	resp.DataSourceData = client
	resp.ResourceData = client
}

func (p *ArcaniumProvider) Resources(_ context.Context) []func() resource.Resource {
	return []func() resource.Resource{
		NewApplicationResource,
	}
}

func (p *ArcaniumProvider) DataSources(_ context.Context) []func() datasource.DataSource {
	return []func() datasource.DataSource{
		NewApplicationIntentDataSource,
	}
}
