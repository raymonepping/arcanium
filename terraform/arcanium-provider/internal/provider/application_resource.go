package provider

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

var (
	_ resource.Resource              = &ApplicationResource{}
	_ resource.ResourceWithConfigure = &ApplicationResource{}
)

func NewApplicationResource() resource.Resource {
	return &ApplicationResource{}
}

type ApplicationResource struct {
	client *Client
}

type applicationResourceModel struct {
	ID          types.String `tfsdk:"id"`
	Name        types.String `tfsdk:"name"`
	Description types.String `tfsdk:"description"`
	Supplier    types.String `tfsdk:"supplier"`
	SupplierID  types.String `tfsdk:"supplier_id"`
	Environment types.String `tfsdk:"environment"`
}

func (r *ApplicationResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_application"
}

func (r *ApplicationResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "An Arcanium application registry entry " +
			"(POST/PATCH/DELETE /api/v1/applications).",
		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				Computed:      true,
				Description:   "Application UUID assigned by arcanium-api.",
				PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()},
			},
			"name": schema.StringAttribute{
				Required:      true,
				Description:   "Matches ^[a-z0-9_-]{1,128}$ (arcanium-api's own validation).",
				PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()},
			},
			"description": schema.StringAttribute{
				Optional: true,
			},
			"supplier": schema.StringAttribute{
				Optional: true,
				Description: "Supplier NAME (e.g. \"pepsi\") — resolved to a " +
					"supplier_id via GET /api/v1/suppliers, since arcanium-api's " +
					"own applications route only accepts a UUID.",
				PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()},
			},
			"supplier_id": schema.StringAttribute{
				Computed:      true,
				Description:   "Resolved supplier UUID.",
				PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()},
			},
			"environment": schema.StringAttribute{
				Optional:      true,
				Computed:      true,
				Description:   "Defaults to \"production\", matching applications.js's own POST default.",
				PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()},
			},
		},
	}
}

func (r *ApplicationResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	if err := r.configure(req.ProviderData); err != nil {
		resp.Diagnostics.AddError("Unexpected resource configure data", err.Error())
	}
}

func (r *ApplicationResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan applicationResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	var supplierID *string
	if !plan.Supplier.IsNull() && plan.Supplier.ValueString() != "" {
		supplier, err := r.client.FindSupplierByName(ctx, plan.Supplier.ValueString())
		if err != nil {
			resp.Diagnostics.AddError("Unable to resolve supplier", err.Error())
			return
		}
		supplierID = &supplier.ID
	}

	var description *string
	if !plan.Description.IsNull() {
		v := plan.Description.ValueString()
		description = &v
	}

	environment := "production"
	if !plan.Environment.IsNull() && plan.Environment.ValueString() != "" {
		environment = plan.Environment.ValueString()
	}

	app, err := r.client.CreateApplication(ctx, plan.Name.ValueString(), description, supplierID, environment)
	if err != nil {
		resp.Diagnostics.AddError("Unable to create Arcanium application", err.Error())
		return
	}

	plan.ID = types.StringValue(app.ID)
	plan.Environment = types.StringValue(app.Environment)
	if app.SupplierID != nil {
		plan.SupplierID = types.StringValue(*app.SupplierID)
	} else {
		plan.SupplierID = types.StringNull()
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *ApplicationResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state applicationResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	app, err := r.client.GetApplication(ctx, state.ID.ValueString())
	if err != nil {
		if IsNotFound(err) {
			resp.State.RemoveResource(ctx)
			return
		}
		resp.Diagnostics.AddError("Unable to read Arcanium application", err.Error())
		return
	}

	state.Name = types.StringValue(app.Name)
	state.Environment = types.StringValue(app.Environment)
	if app.Description != nil {
		state.Description = types.StringValue(*app.Description)
	} else {
		state.Description = types.StringNull()
	}
	if app.SupplierID != nil {
		state.SupplierID = types.StringValue(*app.SupplierID)
	} else {
		state.SupplierID = types.StringNull()
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *ApplicationResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan applicationResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	var description *string
	if !plan.Description.IsNull() {
		v := plan.Description.ValueString()
		description = &v
	}

	app, err := r.client.UpdateApplication(ctx, plan.ID.ValueString(), description)
	if err != nil {
		resp.Diagnostics.AddError("Unable to update Arcanium application", err.Error())
		return
	}

	plan.Environment = types.StringValue(app.Environment)
	if app.SupplierID != nil {
		plan.SupplierID = types.StringValue(*app.SupplierID)
	} else {
		plan.SupplierID = types.StringNull()
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *ApplicationResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state applicationResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	if err := r.client.DeleteApplication(ctx, state.ID.ValueString()); err != nil && !IsNotFound(err) {
		resp.Diagnostics.AddError("Unable to delete Arcanium application", err.Error())
	}
}

// ConfigureResource wires up the shared client from the provider's
// ResourceData — terraform-plugin-framework calls this via the Configure
// method above; kept separate to satisfy resource.ResourceWithConfigure
// without repeating the nil-check boilerplate inline in every resource file
// this skeleton might grow.
func (r *ApplicationResource) configure(providerData any) error {
	if providerData == nil {
		return nil
	}
	client, ok := providerData.(*Client)
	if !ok {
		return fmt.Errorf("unexpected provider data type: %T", providerData)
	}
	r.client = client
	return nil
}
