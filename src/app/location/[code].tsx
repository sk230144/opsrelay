import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { colors, font, radius, spacing } from '../../theme';
import { Badge, Button, Card, EmptyState, Row, SectionTitle } from '../../components/ui';
import { IncidentCard } from '../../components/IncidentCard';
import { findLocationByCode, incidentsForLocation } from '../../db/repo';
import { useTicker } from '../../hooks/useIncidents';

/**
 * What a staff member sees after scanning a sticker: this location, its open
 * issues, its history, and a way to report something new.
 */
export default function LocationScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const normalized = (code ?? '').toUpperCase();
  const now = useTicker();

  const { data: location } = useQuery({
    queryKey: ['location', normalized],
    queryFn: () => findLocationByCode(normalized),
    enabled: !!normalized,
  });

  const { data: incidents = [], isLoading } = useQuery({
    queryKey: ['location-incidents', normalized],
    queryFn: () => incidentsForLocation(normalized),
    enabled: !!normalized,
  });

  const open = incidents.filter((i) => i.status !== 'resolved');
  const past = incidents.filter((i) => i.status === 'resolved');

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <Card style={styles.head}>
        <Row gap={10}>
          <View style={styles.icon}>
            <MaterialIcons
              name={
                location?.kind === 'equipment'
                  ? 'precision-manufacturing'
                  : location?.kind === 'area'
                    ? 'meeting-room'
                    : 'hotel'
              }
              size={22}
              color={colors.primary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.code}>{normalized}</Text>
            <Text style={styles.name}>{location?.name ?? 'Unregistered location'}</Text>
            {location?.floor ? <Text style={styles.floor}>Floor {location.floor}</Text> : null}
          </View>
        </Row>

        <Row gap={6} style={{ marginTop: spacing(4) }}>
          <Badge
            label={`${open.length} open`}
            color={open.length ? colors.warning : colors.success}
          />
          <Badge label={`${past.length} resolved`} color={colors.textMuted} />
        </Row>
      </Card>

      <Button
        title="Report an issue here"
        icon="add-circle-outline"
        onPress={() => router.push(`/incident/create?code=${encodeURIComponent(normalized)}`)}
        style={{ marginBottom: spacing(6) }}
      />

      <SectionTitle>Current open issues</SectionTitle>
      {isLoading ? null : open.length === 0 ? (
        <Card style={{ marginBottom: spacing(6) }}>
          <EmptyState
            icon="check-circle"
            title="Nothing open here"
            subtitle="This location has no unresolved incidents."
          />
        </Card>
      ) : (
        <View style={{ marginBottom: spacing(4) }}>
          {open.map((i) => (
            <IncidentCard
              key={i.id}
              incident={i}
              now={now}
              onPress={() => router.push(`/incident/${i.id}`)}
            />
          ))}
        </View>
      )}

      {past.length > 0 ? (
        <>
          <SectionTitle>Previous incidents</SectionTitle>
          {past.slice(0, 10).map((i) => (
            <IncidentCard
              key={i.id}
              incident={i}
              now={now}
              onPress={() => router.push(`/incident/${i.id}`)}
            />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { padding: spacing(4), paddingBottom: spacing(10) },
  head: { marginBottom: spacing(4) },
  icon: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: `${colors.primary}1F`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  code: {
    ...font.tiny,
    color: colors.primary,
    letterSpacing: 1,
    marginBottom: spacing(1),
  },
  name: { ...font.h2, color: colors.text },
  floor: { ...font.small, color: colors.textFaint, marginTop: spacing(1) },
});
