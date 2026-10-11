"""Registering the cards as a Lovelace resource: create, update, adopt, remove."""

import asyncio
import importlib
from pathlib import Path
import sys
import types


def _stub(name, **attrs):
    mod = types.ModuleType(name)
    mod.__dict__.update(attrs)
    sys.modules[name] = mod
    return mod


_stub("homeassistant")
_stub("homeassistant.core", HomeAssistant=object)
pkg = types.ModuleType("hr_l")
pkg.__path__ = [str(Path(__file__).parents[1] / "custom_components/hass_recipes")]
sys.modules["hr_l"] = pkg
res = importlib.import_module("hr_l.lovelace_resource")

PATH = "/hass_recipes_static/recipes-cards.js"


class FakeCollection:
    loaded = True

    def __init__(self, items=None):
        self.items = list(items or [])
        self.calls = []

    def async_items(self):
        return self.items

    async def async_create_item(self, data):
        self.calls.append(("create", data))
        item = {"id": f"id{len(self.items)}", "type": data["res_type"], "url": data["url"]}
        self.items.append(item)
        return item

    async def async_update_item(self, item_id, updates):
        self.calls.append(("update", item_id, updates))
        for item in self.items:
            if item["id"] == item_id:
                item["url"], item["type"] = updates["url"], updates["res_type"]

    async def async_delete_item(self, item_id):
        self.calls.append(("delete", item_id))
        self.items = [i for i in self.items if i["id"] != item_id]


def _hass(collection, as_dict=False):
    holder = {"resources": collection} if as_dict else types.SimpleNamespace(resources=collection)
    return types.SimpleNamespace(data={"lovelace": holder})


def _run(coro):
    return asyncio.run(coro)


def test_creates_the_resource_once():
    c = FakeCollection()
    assert _run(res.async_ensure_resource(_hass(c), PATH, "0.4.0")) is True
    assert c.items == [{"id": "id0", "type": "module", "url": f"{PATH}?v=0.4.0"}]
    c.calls.clear()
    assert _run(res.async_ensure_resource(_hass(c), PATH, "0.4.0")) is True
    assert c.calls == []  # already right: nothing written


def test_a_new_version_updates_the_same_entry():
    c = FakeCollection([{"id": "a", "type": "module", "url": f"{PATH}?v=0.3.0"}])
    assert _run(res.async_ensure_resource(_hass(c), PATH, "0.4.0")) is True
    assert [i["url"] for i in c.items] == [f"{PATH}?v=0.4.0"]
    assert c.calls[0][0] == "update"


def test_an_entry_added_by_hand_is_adopted_and_duplicates_removed():
    c = FakeCollection(
        [
            {"id": "a", "type": "js", "url": PATH},  # added by hand, no version, wrong type
            {"id": "b", "type": "module", "url": f"{PATH}?v=old"},
            {"id": "x", "type": "module", "url": "/hacsfiles/other-card/other.js"},
        ]
    )
    _run(res.async_ensure_resource(_hass(c), PATH, "0.4.0"))
    urls = sorted(i["url"] for i in c.items)
    assert urls == sorted([f"{PATH}?v=0.4.0", "/hacsfiles/other-card/other.js"])
    assert next(i for i in c.items if i["id"] == "a")["type"] == "module"


def test_unavailable_lovelace_or_yaml_resources_are_not_an_error():
    assert _run(res.async_ensure_resource(types.SimpleNamespace(data={}), PATH, "1")) is False

    class YamlCollection:  # no async_create_item
        loaded = True

        def async_items(self):
            return []

    assert _run(res.async_ensure_resource(_hass(YamlCollection()), PATH, "1")) is False


def test_older_home_assistant_kept_resources_in_a_dict():
    c = FakeCollection()
    assert _run(res.async_ensure_resource(_hass(c, as_dict=True), PATH, "0.4.0")) is True
    assert len(c.items) == 1


def test_a_failing_collection_never_raises():
    class Broken(FakeCollection):
        async def async_create_item(self, data):
            raise RuntimeError("boom")

    assert _run(res.async_ensure_resource(_hass(Broken()), PATH, "1")) is False


def test_removing_the_integration_removes_only_its_resource():
    c = FakeCollection(
        [
            {"id": "a", "type": "module", "url": f"{PATH}?v=0.4.0"},
            {"id": "x", "type": "module", "url": "/hacsfiles/other-card/other.js"},
        ]
    )
    _run(res.async_remove_resource(_hass(c), PATH))
    assert [i["id"] for i in c.items] == ["x"]
