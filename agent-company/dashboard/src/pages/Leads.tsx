import { useState } from 'react';
import { Text, Group, Stack, Table, Badge, TextInput, Select, ActionIcon, Modal, ScrollArea, Button } from '@mantine/core';
import { IconSearch, IconTrash, IconEye } from '@tabler/icons-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getLeads, getLeadFacets, deleteLead, updateLead } from '../lib/api';

const statusColors: Record<string, string> = {
  new: 'gray',
  researched: 'blue',
  not_contacted: 'yellow',
  contacted_interested: 'green',
  contacted_uninterested: 'orange',
  converted: 'teal',
  lost: 'red',
};

const scoreColor = (score: number | null) => {
  if (!score) return 'gray';
  if (score >= 90) return 'green';
  if (score >= 70) return 'yellow';
  if (score >= 50) return 'orange';
  return 'red';
};

export function LeadsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string | null>(null);
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const [industryFilter, setIndustryFilter] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Record<string, unknown> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);

  // Build filter params for both leads and facets queries
  const filterParams: Record<string, string> = {};
  if (statusFilter) filterParams.status = statusFilter;
  if (stateFilter) filterParams.state = stateFilter;
  if (cityFilter) filterParams.city = cityFilter;
  if (industryFilter) filterParams.industry = industryFilter;

  const { data, isLoading } = useQuery({
    queryKey: ['leads', filterParams],
    queryFn: () => getLeads({ ...filterParams, limit: 500 }),
    refetchInterval: 30000,
  });

  const { data: facets } = useQuery({
    queryKey: ['lead-facets', filterParams],
    queryFn: () => getLeadFacets(filterParams),
    refetchInterval: 30000,
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => deleteLead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead-facets'] });
    },
  });

  // Prevent unused import warning
  void updateLead;

  const leads = ((data as any)?.leads ?? []) as Record<string, unknown>[];
  const filtered = search
    ? leads.filter((l) => {
        const s = search.toLowerCase();
        return (
          String(l.business_name ?? '').toLowerCase().includes(s) ||
          String(l.city ?? '').toLowerCase().includes(s) ||
          String(l.industry ?? '').toLowerCase().includes(s) ||
          String(l.owner_name ?? '').toLowerCase().includes(s)
        );
      })
    : leads;

  const facetData = facets as { states: string[]; cities: string[]; industries: string[]; statuses: string[] } | undefined;

  return (
    <Stack>
      <Group justify="space-between">
        <Text size="lg" fw={600}>Leads ({filtered.length})</Text>
      </Group>

      <Group>
        <TextInput
          placeholder="Search by name, city, industry..."
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          style={{ flex: 1 }}
        />
        <Select
          placeholder="All statuses"
          clearable
          value={statusFilter}
          onChange={setStatusFilter}
          data={facetData?.statuses ?? []}
          w={180}
        />
        <Select
          placeholder="All states"
          clearable
          searchable
          value={stateFilter}
          onChange={(val) => {
            setStateFilter(val);
            // Clear city if it won't exist in the new state
            setCityFilter(null);
          }}
          data={facetData?.states ?? []}
          w={140}
        />
        <Select
          placeholder="All cities"
          clearable
          searchable
          value={cityFilter}
          onChange={setCityFilter}
          data={facetData?.cities ?? []}
          w={180}
        />
        <Select
          placeholder="All industries"
          clearable
          searchable
          value={industryFilter}
          onChange={setIndustryFilter}
          data={facetData?.industries ?? []}
          w={200}
        />
      </Group>

      <ScrollArea>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Business</Table.Th>
              <Table.Th>City</Table.Th>
              <Table.Th>Industry</Table.Th>
              <Table.Th>Score</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Owner</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading && (
              <Table.Tr><Table.Td colSpan={7}><Text c="dimmed" ta="center">Loading...</Text></Table.Td></Table.Tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <Table.Tr><Table.Td colSpan={7}><Text c="dimmed" ta="center">No leads found</Text></Table.Td></Table.Tr>
            )}
            {filtered.map((lead) => (
              <Table.Tr key={String(lead.id)}>
                <Table.Td fw={500}>{String(lead.business_name ?? '')}</Table.Td>
                <Table.Td>{String(lead.city ?? '')}, {String(lead.state ?? '')}</Table.Td>
                <Table.Td>{String(lead.industry ?? lead.category ?? '')}</Table.Td>
                <Table.Td>
                  <Badge color={scoreColor(lead.lead_score as number)} variant="light">
                    {String(lead.lead_score ?? '-')}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Badge color={statusColors[String(lead.status)] ?? 'gray'} variant="light">
                    {String(lead.status ?? 'new')}
                  </Badge>
                </Table.Td>
                <Table.Td>{String(lead.owner_name ?? '-')}</Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <ActionIcon variant="subtle" onClick={() => setSelectedLead(lead)} title="View">
                      <IconEye size={16} />
                    </ActionIcon>
                    <ActionIcon variant="subtle" color="red" onClick={() => setDeleteTarget(lead)} title="Delete">
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>

      <Modal
        opened={!!selectedLead}
        onClose={() => setSelectedLead(null)}
        title={String(selectedLead?.business_name ?? 'Lead Detail')}
        size="xl"
      >
        {selectedLead && (
          <ScrollArea h={500}>
            <Stack gap="xs">
              {Object.entries(selectedLead)
                .filter(([k]) => !['id', 'source_id', 'dedup_hash', 'raw_data', 'search_vector'].includes(k))
                .map(([key, value]) => (
                  <Group key={key} justify="space-between" wrap="nowrap">
                    <Text size="sm" c="dimmed" w={180} style={{ flexShrink: 0 }}>{key}</Text>
                    <Text size="sm" style={{ wordBreak: 'break-all' }}>
                      {typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value ?? '-')}
                    </Text>
                  </Group>
                ))}
            </Stack>
          </ScrollArea>
        )}
      </Modal>

      <Modal
        opened={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Lead"
        size="sm"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Are you sure you want to delete <Text span fw={700}>{String(deleteTarget?.business_name ?? '')}</Text>? This cannot be undone.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              color="red"
              loading={deleteM.isPending}
              onClick={() => {
                deleteM.mutate(String(deleteTarget?.id), {
                  onSuccess: () => setDeleteTarget(null),
                });
              }}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
