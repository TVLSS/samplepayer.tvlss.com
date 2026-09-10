from agents.benefits import benefits
from agents.claims import claims_agent
from agents.membership import membership
from agents.group import group_agent
from agents.accumulations import accumulations_agent
from agents.health import health_services
from agents.providers import provider_network

AGENTS = {a.id: a for a in [benefits, claims_agent, membership, group_agent, accumulations_agent, health_services, provider_network]}
