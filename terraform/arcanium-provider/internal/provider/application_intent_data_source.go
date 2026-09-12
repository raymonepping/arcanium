package provider

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

var (
	_ datasource.DataSource              = &ApplicationIntentDataSource{}
	_ datasource.DataSourceWithConfigure = &ApplicationIntentDataSource{}
)

func NewApplicationIntentDataSource() datasource.DataSource {
	return &ApplicationIntentDataSource{}
}

type ApplicationIntentDataSource struct {
	client *Client
}

type applicationIntentModel struct {
	ApplicationID types.String `tfsdk:"application_id"`
	Environment   types.String `tfsdk:"environment"`
	Summary       types.String `tfsdk:"summary"`
	JSON          types.String `tfsdk:"json"`
}

func (d *ApplicationIntentDataSource) Metadata(_ context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_application_intent"
}

func (d *ApplicationIntentDataSource) Schema(_ context.Context, _ datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Reads GET /api/v1/applications/{id}/intent — the same " +
			"aggregated lifecycle/governance/tenant view the UI dashboard " +
			"reads (arcanium/api/src/aggregation/intent.js).",
		Attributes: map[string]schema.Attribute{
			"application_id": schema.StringAttribute{
				Required: true,
			},
			"environment": schema.StringAttribute{
				Computed:    true,
				Description: "The application's environment tag (Prompt 27).",
			},
			"summary": schema.StringAttribute{
				Computed:    true,
				Description: "intent.entry_story.summary — the same human-readable sentence the dashboard's Estate Story Summary card renders.",
			},
			"json": schema.StringAttribute{
				Computed:    true,
				Description: "The full intent response, verbatim, as a JSON string — the API's own response shape is intentionally NOT re-modeled field-by-field here (see client.go).",
			},
		},
	}
}

func (d *ApplicationIntentDataSource) Configure(_ context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}
	client, ok := req.ProviderData.(*Client)
	if !ok {
		resp.Diagnostics.AddError("Unexpected data source configure data", fmt.Sprintf("unexpected provider data type: %T", req.ProviderData))
		return
	}
	d.client = client
}

func (d *ApplicationIntentDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	var cfg applicationIntentModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &cfg)...)
	if resp.Diagnostics.HasError() {
		return
	}

	intent, err := d.client.GetApplicationIntent(ctx, cfg.ApplicationID.ValueString())
	if err != nil {
		resp.Diagnostics.AddError("Unable to read Arcanium application intent", err.Error())
		return
	}

	raw, err := json.Marshal(intent)
	if err != nil {
		resp.Diagnostics.AddError("Unable to encode intent response", err.Error())
		return
	}
	cfg.JSON = types.StringValue(string(raw))

	if env, ok := intent["environment"].(string); ok {
		cfg.Environment = types.StringValue(env)
	} else {
		cfg.Environment = types.StringNull()
	}

	if story, ok := intent["entry_story"].(map[string]any); ok {
		if summary, ok := story["summary"].(string); ok {
			cfg.Summary = types.StringValue(summary)
		}
	}
	if cfg.Summary.IsNull() || cfg.Summary.IsUnknown() {
		cfg.Summary = types.StringValue("")
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &cfg)...)
}
