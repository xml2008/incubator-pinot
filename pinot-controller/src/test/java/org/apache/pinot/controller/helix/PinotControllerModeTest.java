/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
package org.apache.pinot.controller.helix;

import java.util.Map;
import org.apache.helix.HelixManager;
import org.apache.helix.model.ExternalView;
import org.apache.pinot.common.utils.CommonConstants;
import org.apache.pinot.controller.ControllerConf;
import org.apache.pinot.controller.ControllerStarter;
import org.apache.pinot.util.TestUtils;
import org.testng.Assert;
import org.testng.annotations.AfterClass;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;


public class PinotControllerModeTest extends ControllerTest {
  private static long TIMEOUT_IN_MS = 10_000L;
  private ControllerConf config;
  private int controllerPortOffset;

  @BeforeClass
  public void setUp() {
    startZk();
    config = getDefaultControllerConfiguration();
//    config.setEnableLeadControllerResource(true);
    controllerPortOffset = 0;
  }

  @Test
  public void testHelixOnlyController()
      throws Exception {
    config.setControllerMode(ControllerConf.ControllerMode.HELIX_ONLY);
    config.setControllerPort(Integer.toString(Integer.parseInt(config.getControllerPort()) + controllerPortOffset++));

    startController(config);
    TestUtils.waitForCondition(aVoid -> _helixManager.isConnected(), TIMEOUT_IN_MS,
        "Failed to start " + config.getControllerMode() + " controller in " + TIMEOUT_IN_MS + "ms.");

    Assert.assertEquals(_controllerStarter.getControllerMode(), ControllerConf.ControllerMode.HELIX_ONLY);

    stopController();
    _controllerStarter = null;
  }

  @Test
  public void testDualModeController()
      throws Exception {
    config.setControllerMode(ControllerConf.ControllerMode.DUAL);
    config.setControllerPort(Integer.toString(Integer.parseInt(config.getControllerPort()) + controllerPortOffset++));

    startController(config);
    TestUtils.waitForCondition(aVoid -> _helixManager.isConnected(), TIMEOUT_IN_MS,
        "Failed to start " + config.getControllerMode() + " controller in " + TIMEOUT_IN_MS + "ms.");
    Assert.assertEquals(_controllerStarter.getControllerMode(), ControllerConf.ControllerMode.DUAL);

    stopController();
    _controllerStarter = null;
  }

  @Test
  public void testPinotOnlyController()
      throws Exception {

    config.setControllerMode(ControllerConf.ControllerMode.PINOT_ONLY);
    config.setControllerPort(Integer.toString(Integer.parseInt(config.getControllerPort()) + controllerPortOffset++));

    // Starting pinot only controller before starting helix controller should fail.
    try {
      startController(config);
      Assert.fail("Starting pinot only controller should fail!");
    } catch (RuntimeException e) {
      _controllerStarter = null;
    }

    // Starting a helix controller.
    ControllerConf config2 = getDefaultControllerConfiguration();
    config2.setHelixClusterName(getHelixClusterName());
    config2.setControllerMode(ControllerConf.ControllerMode.HELIX_ONLY);
    config2.setControllerPort(Integer.toString(Integer.parseInt(config.getControllerPort()) + controllerPortOffset++));
    ControllerStarter helixControllerStarter = new ControllerStarter(config2);
    helixControllerStarter.start();
    HelixManager helixControllerManager = helixControllerStarter.getHelixControllerManager();
    TestUtils.waitForCondition(aVoid -> helixControllerManager.isConnected(), TIMEOUT_IN_MS,
        "Failed to start " + config2.getControllerMode() + " controller in " + TIMEOUT_IN_MS + "ms.");

    // Enable the lead controller resource.
    helixControllerManager.getClusterManagmentTool()
        .enableResource(getHelixClusterName(), CommonConstants.Helix.LEAD_CONTROLLER_RESOURCE_NAME, true);

    // Starting a pinot only controller.
    startController(config, false);
    TestUtils.waitForCondition(aVoid -> _helixResourceManager.getHelixZkManager().isConnected(), TIMEOUT_IN_MS,
        "Failed to start " + config.getControllerMode() + " controller in " + TIMEOUT_IN_MS + "ms.");
    Assert.assertEquals(_controllerStarter.getControllerMode(), ControllerConf.ControllerMode.PINOT_ONLY);

    // Start a second Pinot only controller.
    config.setControllerPort(Integer.toString(Integer.parseInt(config.getControllerPort()) + controllerPortOffset++));
    ControllerStarter secondControllerStarter = new TestOnlyControllerStarter(config);

    secondControllerStarter.start();
    // Two controller instances assigned to cluster.
    TestUtils.waitForCondition(aVoid -> _helixResourceManager.getAllInstances().size() == 2, TIMEOUT_IN_MS,
        "Failed to start the 2nd pinot only controller in " + TIMEOUT_IN_MS + "ms.");

    // Disable lead controller resource, all the participants are in offline state (from slave state).
    helixControllerManager.getClusterManagmentTool().enableResource(getHelixClusterName(), CommonConstants.Helix.LEAD_CONTROLLER_RESOURCE_NAME, false);

    TestUtils.waitForCondition(aVoid -> {
          ExternalView leadControllerResourceExternalView = _helixResourceManager.getLeadControllerResourceExternalView();
          for (String partition : leadControllerResourceExternalView.getPartitionSet()) {
            Map<String, String> stateMap = leadControllerResourceExternalView.getStateMap(partition);
            Assert.assertEquals(stateMap.size(), 2);

            for (Map.Entry<String, String> entry : stateMap.entrySet()) {
              if (!"OFFLINE".equals(entry.getValue())) {
                return false;
              }
            }
          }
          return true;
        }, TIMEOUT_IN_MS, "Failed to mark all the participants offline in " + TIMEOUT_IN_MS + "ms.");

    secondControllerStarter.stop();
    stopController();
    _controllerStarter = null;
    helixControllerStarter.stop();
  }

  @AfterClass
  public void tearDown() {
    stopZk();
  }
}
