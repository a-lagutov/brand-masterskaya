"""Convert completed legacy Packager manifests to VOD without changing encrypted fragments."""
import math
import os
import pathlib
import re
import shutil
import sys
import tempfile
import xml.etree.ElementTree as element_tree

DASH_NAMESPACE = 'urn:mpeg:dash:schema:mpd:2011'
element_tree.register_namespace('', DASH_NAMESPACE)
element_tree.register_namespace('cenc', 'urn:mpeg:cenc:2013')
element_tree.register_namespace('xsi', 'http://www.w3.org/2001/XMLSchema-instance')


def repair_manifest(filename):
    """Repair only complete, single-period recordings; preserve an original backup and replace atomically."""
    tree = element_tree.parse(str(filename))
    root = tree.getroot()
    if root.get('type') != 'dynamic':
        return False
    periods = root.findall('{' + DASH_NAMESPACE + '}Period')
    if len(periods) != 1 or periods[0].get('start', 'PT0S') != 'PT0S':
        raise ValueError('Unsupported recording periods')
    templates = root.findall('.//{' + DASH_NAMESPACE + '}SegmentTemplate')
    durations = []
    for template in templates:
        scale = int(template.get('timescale', '1'))
        offset = int(template.get('presentationTimeOffset', '0'))
        timeline = template.find('{' + DASH_NAMESPACE + '}SegmentTimeline')
        if scale <= 0 or timeline is None or not len(timeline):
            raise ValueError('Missing complete segment timeline')
        end = 0
        for index, segment in enumerate(timeline):
            start = int(segment.get('t', str(end)))
            length = int(segment.get('d', '0'))
            repeat = int(segment.get('r', '0'))
            if length <= 0 or repeat < 0 or (index == 0 and start > offset):
                raise ValueError('Incomplete recording timeline')
            end = start + length * (repeat + 1)
        durations.append((end - offset) / scale)
    duration = max(durations) if durations else 0
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('Invalid recording duration')
    root.set('type', 'static')
    root.set('mediaPresentationDuration', 'PT' + format(duration, '.9f').rstrip('0').rstrip('.') + 'S')
    for attribute in ['availabilityStartTime', 'publishTime', 'minimumUpdatePeriod',
                      'timeShiftBufferDepth', 'suggestedPresentationDelay', 'availabilityEndTime']:
        root.attrib.pop(attribute, None)
    backup = filename.with_name(filename.name + '.pre-vod')
    if not backup.exists():
        shutil.copy2(str(filename), str(backup))
    temporary = ''
    try:
        with tempfile.NamedTemporaryFile(dir=str(filename.parent), delete=False) as output:
            temporary = output.name
            tree.write(output, encoding='utf-8', xml_declaration=True)
        os.replace(temporary, str(filename))
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
    return True


def repair_directory(directory):
    """Visit only final UUID stream directories, leaving work files and unrelated content untouched."""
    repaired = 0
    skipped = 0
    for filename in directory.glob('*/manifest.mpd'):
        if not re.fullmatch('[a-f0-9-]{36}', filename.parent.name):
            continue
        try:
            repaired += int(repair_manifest(filename))
        except (ValueError, element_tree.ParseError):
            skipped += 1
    print('VOD manifests repaired: ' + str(repaired) + '; incomplete manifests skipped: ' + str(skipped))


if __name__ == '__main__':
    repair_directory(pathlib.Path(sys.argv[1]))
